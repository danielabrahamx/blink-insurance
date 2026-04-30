const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { createGatewayMiddleware } = require('@circlefin/x402-batching/server');
const blinkContractArtifact = require('./blink-contract-abi.json');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Backward-compat: accept the legacy BLINK_CONTRACT_ADDRESS env var if present so
// existing local .env files keep working until operators cut over.
const BLINK_CONTRACT_ADDRESS =
  process.env.BLINK_CONTRACT_ADDRESS || process.env.PARAMIFY_ADDRESS;
const ARC_RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const BLINK_CONTRACT_ABI = blinkContractArtifact.abi || blinkContractArtifact;

// Arc Testnet token addresses (used by /api/admin/* routes)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

// Lazy-init Circle Developer-Controlled Wallets client. Keeps server boot
// unblocked if CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET are missing; errors
// surface only when an admin route is actually called.
let circleClient = null;
function getCircleClient() {
  if (circleClient) return circleClient;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error('Circle DCV not configured (missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET)');
  }
  const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
  circleClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return circleClient;
}

// In-memory accumulators (demo state)
let totalPremiumsUsdc = 0;
const lastTxs = [];
const TX_CAP = 100;

function recordTx(entry) {
  lastTxs.push(entry);
  if (lastTxs.length > TX_CAP) lastTxs.shift();
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Middleware
app.use(cors({
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}));
app.use(express.json());

// --- x402 Gateway ---
const gateway = createGatewayMiddleware({
  sellerAddress: process.env.CIRCLE_WALLET_ADDRESS,
  networks: ['eip155:5042002'], // Arc Testnet only
});

// --- AI Actuary: normalized pricing model (k·x + m·(1-x) = 1) ---
let pricingState = {
  k: 0.8,
  x_expected: 0.5,
  base_price_usdc_per_sec: 0.000003,
};

function computeM(k, x) {
  return (1 - k * x) / (1 - x);
}

function atDeskPriceUsdc() {
  return pricingState.k * pricingState.base_price_usdc_per_sec;
}

function onTheMovePriceUsdc() {
  return computeM(pricingState.k, pricingState.x_expected) * pricingState.base_price_usdc_per_sec;
}

// Lazy-init Anthropic client for Module B (External Intelligence).
// Requires @anthropic-ai/sdk: run `npm install @anthropic-ai/sdk` in backend/.
let anthropicClient = null;
function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// --- Billed route definitions ---
// Two priced endpoints — policy mode is the only rating factor.
// gateway.require() enforces x402 payment at the fixed price strings below;
// per-second accounting uses pricingState (updated by AI Actuary recommendations).
const BILLED = [
  { path: '/api/insure/at-desk',     mode: 'atDesk',    price: '$0.000003' },
  { path: '/api/insure/on-the-move', mode: 'onTheMove', price: '$0.000006' },
];

for (const route of BILLED) {
  app.get(route.path, gateway.require(route.price), (req, res) => {
    const priceUsdc = route.mode === 'atDesk' ? atDeskPriceUsdc() : onTheMovePriceUsdc();
    totalPremiumsUsdc += priceUsdc;
    const premiumMicroUsdc = Math.round(priceUsdc * 1e6);
    const payload = {
      ok: true,
      mode: route.mode,
      premiumMicroUsdc,
      txPayer: req.payment?.payer,
      txAmount: req.payment?.amount,
      network: req.payment?.network,
      txHash: req.payment?.transaction,
    };
    recordTx({
      ...payload,
      path: route.path,
      timestamp: new Date().toISOString(),
    });
    res.json(payload);
  });
}

// --- Unbilled routes ---

// GET /admin/role - returns the role for the wallet in X-Admin-Wallet header.
// For local dev any wallet resolves to 'admin'. Production should enforce an allowlist.
app.get('/admin/role', (req, res) => {
  const wallet = req.headers['x-admin-wallet'];
  if (!wallet) return res.status(401).json({ error: 'X-Admin-Wallet header required' });
  res.json({ wallet_addr: wallet, role: 'admin' });
});

// GET /admin/metrics - aggregate metrics for the admin MetricsPanel.
// TODO: implement with real per-policy data once the claims pipeline is wired.
app.get('/admin/metrics', (req, res) => {
  res.json({
    active_policies: lastTxs.filter(tx => tx.mode === 'atDesk' || tx.mode === 'onTheMove').length,
    avg_multiplier: null,
    ingest_latency_ms: { p50: null, p95: null, p99: null },
    claim_queue_depth: 0,
    authorization_consumption_pct: null,
    total_premiums_usdc: Number(totalPremiumsUsdc.toFixed(6)),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    totalPremiumsUsdc: Number(totalPremiumsUsdc.toFixed(6)),
    lastTxs,
  });
});

app.get('/api/status', async (req, res) => {
  const sellerAddress = process.env.CIRCLE_WALLET_ADDRESS || null;
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const contract = new ethers.Contract(BLINK_CONTRACT_ADDRESS, BLINK_CONTRACT_ABI, provider);
    const [usdcPool, usycReserve] = await Promise.all([
      contract.usdcPool(),
      contract.usycReserve(),
    ]);
    const usdcPoolFormatted = ethers.formatUnits(usdcPool, 6);
    const usycReserveFormatted = ethers.formatUnits(usycReserve, 6);
    res.json({
      sellerAddress,
      contractUsdcPool: usdcPoolFormatted,
      contractUsycReserve: usycReserveFormatted,
      usdcPool: usdcPoolFormatted,
      usycReserve: usycReserveFormatted,
      txCount: lastTxs.length,
    });
  } catch (error) {
    res.json({
      error: error.message,
      sellerAddress,
      contractUsdcPool: null,
      contractUsycReserve: null,
      usdcPool: null,
      usycReserve: null,
      txCount: lastTxs.length,
    });
  }
});

// GET /api/balance/:address - convenience alias for the admin portal
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const [usdcBal, usycBal] = await Promise.all([
      usdc.balanceOf(address).catch(() => 0n),
      usyc.balanceOf(address).catch(() => 0n),
    ]);
    res.json({
      address,
      usdc: ethers.formatUnits(usdcBal, 6),
      usyc: ethers.formatUnits(usycBal, 6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Admin routes (unbilled) ---

// GET /api/admin/balance/:address - on-chain USDC + USYC balances
app.get('/api/admin/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider);
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_BALANCE_ABI, provider);

    const [usdcBal, usycBal] = await Promise.all([
      usdc.balanceOf(address).catch(() => 0n),
      usyc.balanceOf(address).catch(() => 0n),
    ]);

    res.json({
      address,
      usdc: ethers.formatUnits(usdcBal, 6),
      usyc: ethers.formatUnits(usycBal, 6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/wallet-balance - Circle DCV wallet token balances
app.get('/api/admin/wallet-balance', async (req, res) => {
  try {
    const walletId = process.env.CIRCLE_WALLET_ID;
    if (!walletId) {
      return res.status(500).json({ error: 'CIRCLE_WALLET_ID not set', tokenBalances: [] });
    }
    const client = getCircleClient();
    const balRes = await client.getWalletTokenBalance({ id: walletId });
    const tokenBalances = balRes?.data?.tokenBalances || [];
    res.json({
      walletId,
      address: process.env.CIRCLE_WALLET_ADDRESS || null,
      tokenBalances,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, tokenBalances: [] });
  }
});

// POST /api/admin/deposit-reserve - body { amountUsyc } human units
app.post('/api/admin/deposit-reserve', async (req, res) => {
  try {
    const { amountUsyc } = req.body || {};
    const amount = Number(amountUsyc);
    if (!amount || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amountUsyc required and must be > 0' });
    }
    const walletId = process.env.CIRCLE_WALLET_ID;
    if (!walletId) {
      return res.status(500).json({ ok: false, error: 'CIRCLE_WALLET_ID not set' });
    }
    if (!BLINK_CONTRACT_ADDRESS) {
      return res.status(500).json({ ok: false, error: 'BLINK_CONTRACT_ADDRESS not set' });
    }
    const client = getCircleClient();
    const amountUnits = (BigInt(Math.round(amount * 1e6))).toString();
    const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

    // 1) Approve the Blink contract to pull USYC from the DCV wallet
    await client.createContractExecutionTransaction({
      walletId,
      contractAddress: USYC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [BLINK_CONTRACT_ADDRESS, MAX_UINT256],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await new Promise((r) => setTimeout(r, 3000));

    // 2) Call depositReserve(uint256) on the Blink contract
    const depositTx = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: BLINK_CONTRACT_ADDRESS,
      abiFunctionSignature: 'depositReserve(uint256)',
      abiParameters: [amountUnits],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    res.json({ ok: true, txId: depositTx?.data?.id || null, amountUsyc: amount });
  } catch (error) {
    console.error('deposit-reserve error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- AI Actuary endpoints ---

// GET /admin/pricing — current normalized pricing model
app.get('/admin/pricing', (req, res) => {
  const m = computeM(pricingState.k, pricingState.x_expected);
  res.json({ ...pricingState, m });
});

// POST /admin/pricing — accept a Module C recommendation (k + x_expected only; m is derived)
app.post('/admin/pricing', (req, res) => {
  const { k, x_expected } = req.body || {};
  if (typeof k !== 'number' || typeof x_expected !== 'number') {
    return res.status(400).json({ error: 'k and x_expected required as numbers' });
  }
  if (k < 0.5 || k > 1.5) {
    return res.status(400).json({ error: 'k must be in [0.5, 1.5]' });
  }
  if (x_expected <= 0 || x_expected >= 1) {
    return res.status(400).json({ error: 'x_expected must be in (0, 1)' });
  }
  const m = computeM(k, x_expected);
  if (m < 0.5 || m > 3.0) {
    return res.status(400).json({ error: `Derived m=${m.toFixed(4)} is outside [0.5, 3.0]` });
  }
  const maxChange = 0.25;
  const changeK = Math.abs(k - pricingState.k) / pricingState.k;
  if (changeK > maxChange) {
    return res.status(400).json({ error: `k change ${(changeK * 100).toFixed(1)}% exceeds 25% per cycle` });
  }
  pricingState = { ...pricingState, k, x_expected };
  res.json({ ok: true, ...pricingState, m });
});

// In-memory cache for Module B investigation results (cleared on restart).
let lastInvestigation = null;

// GET /admin/actuary/investigation — return last cached investigation or null
app.get('/admin/actuary/investigation', (req, res) => {
  res.json(lastInvestigation);
});

// POST /admin/actuary/investigate — run a new MacBook issue investigation via Claude + web_search
app.post('/admin/actuary/investigate', async (req, res) => {
  // Return cache if fresh (< 7 days)
  if (lastInvestigation) {
    const ageMs = Date.now() - lastInvestigation.fetchedAt;
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      return res.json(lastInvestigation);
    }
  }

  let client;
  try {
    client = getAnthropicClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const systemPrompt = `You are an insurance underwriting assistant. Research confirmed hardware and battery issues with Apple MacBook laptops by searching current tech news, developer forums, and user reports. You MUST use the web_search tool to find real sources from multiple independent outlets. Do not report unconfirmed speculation. Return ONLY valid JSON with no other text, matching this schema exactly:
{"product":string,"issues":[{"title":string,"frequency":"low"|"medium"|"high","severity":"low"|"medium"|"high","sources_count":integer}],"trend":"increasing"|"stable"|"decreasing","confidence_score":number}`;

  const messages = [
    {
      role: 'user',
      content: 'Search for current Apple MacBook hardware and battery issues in 2024-2025. Aggregate from multiple independent sources and return the JSON report.',
    },
  ];

  try {
    let response;
    // Manual loop to let Claude use web_search before producing final JSON
    while (true) {
      response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: systemPrompt,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
        messages,
      });

      if (response.stop_reason === 'end_turn') break;

      // Append assistant turn and tool results to continue the loop
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = response.content
        .filter(b => b.type === 'tool_result' || b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: b.content || '',
        }));
      if (toolResults.length === 0) break; // no pending tool calls
      messages.push({ role: 'user', content: toolResults });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || !textBlock.text) {
      return res.status(502).json({ error: 'No text in Claude response' });
    }

    // Extract JSON from the text (Claude may wrap it in markdown code fences)
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'No JSON found in response', raw: textBlock.text.slice(0, 500) });
    }

    const data = JSON.parse(jsonMatch[0]);
    lastInvestigation = { data, fetchedAt: Date.now() };
    res.json(lastInvestigation);
  } catch (err) {
    console.error('[actuary/investigate]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settle', (req, res) => {
  const { totalMicroUsdc = 0, state = {}, txHashes = [] } = req.body || {};
  const receiptId = randomHex(16);
  res.json({
    settled: true,
    receiptId,
    totalMicroUsdc,
    state,
    txHashes,
    timestamp: new Date().toISOString(),
  });
});

// --- Startup ---
function startServer() {
  app.listen(PORT, () => {
    console.log(`Blink backend running on port ${PORT}`);
    console.log(`Seller: ${process.env.CIRCLE_WALLET_ADDRESS}`);
    console.log(`Blink contract: ${BLINK_CONTRACT_ADDRESS} @ ${ARC_RPC_URL}`);
    console.log('Billed routes:');
    for (const r of BILLED) console.log(`   GET ${r.path}  (${r.price})`);
    console.log('Unbilled: GET /api/health, GET /api/status, POST /api/settle');
  });
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

if (require.main === module) startServer();

module.exports = app;
