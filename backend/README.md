# Blink Backend

Node.js + Express server that handles per-second x402 micropayments and manages the on-chain reserve pool.

## Deployment

- **Local dev:** `npm start` — runs on `http://localhost:3001`
- **Production:** Fly.io at `https://blink-prod-backend.fly.dev`
  - Deploy: `flyctl deploy --build-arg CLOUDSMITH_TOKEN=<token>` (from this directory)
  - Machines auto-sleep when idle; first request cold-starts in ~2s

## Key routes

| Route | Auth | Description |
|---|---|---|
| `GET /api/insure/at-desk` | x402 payment | Processes a per-second charge at the At Desk (1×) rate |
| `GET /api/insure/on-the-move` | x402 payment | Processes a per-second charge at the On the Move (2×) rate |
| `GET /api/health` | none | Live check — uptime, total premiums collected, recent tx list |
| `GET /api/status` | none | Contract pool balances (USDC + USYC) |
| `GET /admin/metrics` | none | Aggregate metrics for the admin dashboard |
| `POST /api/settle` | none | Session settlement receipt (records totals, issues receipt ID) |
| `GET /api/balance/:address` | none | On-chain USDC + USYC balance for any address |
| `POST /api/admin/deposit-reserve` | none | Deposit USYC to the on-chain reserve via Circle DCV |
| `POST /api/admin/trigger-claim` | none | Pay out USDC from reserve to a recipient |

## Environment variables

| Variable | Description |
|---|---|
| `CIRCLE_API_KEY` | Circle Developer API key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret for DCV signing |
| `CIRCLE_WALLET_ID` | The seller's Circle DCV wallet ID |
| `CIRCLE_WALLET_ADDRESS` | The seller's EVM wallet address (also the x402 payment recipient) |
| `BLINK_CONTRACT_ADDRESS` / `PARAMIFY_ADDRESS` | Contract address on Arc Testnet — both env var names are accepted for backward compat |
| `ARC_RPC_URL` | Arc Testnet RPC (default: `https://rpc.testnet.arc.network`) |
| `PORT` | Server port (default: 3001) |

## Blink contract

**Address (Arc Testnet):** `0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43`

**ABI:** `blink-contract-abi.json`

The contract holds the insurance reserve pool and manages policy lifecycle:

- **`buyInsurance(uint256 _coverage)`** — customer buys a policy; premium flows from caller to pool
- **`depositReserve(uint256 _amount)`** — admin deposits USYC collateral backing the reserve
- **`triggerPayout()`** — admin triggers a claim payout from the pool to the insured customer
- **`usdcPool()`** / **`usycReserve()`** — read current pool balances
- **`withdrawUSDC/withdrawUSYC`** — admin sweep functions

Role-based access control (`DEFAULT_ADMIN_ROLE`, `INSURANCE_ADMIN_ROLE`, `RESERVE_MANAGER_ROLE`) — all three roles must be assigned to the seller wallet.

The contract also has a parametric oracle integration (`floodThreshold`, `getLatestPrice`, `setThreshold`) from its original design; this is not used in the current Blink demo flow.

## x402 payment flow

1. Frontend calls `GET /api/insure/at-desk` or `/api/insure/on-the-move` without a payment header
2. Backend returns `402` with `PAYMENT-REQUIRED` header (signed requirements via Circle Gateway)
3. Frontend SDK signs an EIP-3009 `TransferWithAuthorization` and retries with `Payment-Signature` header
4. Backend verifies via Circle's facilitator API, settles the µ-USDC transfer, and returns the policy tick response

See `frontend/src/lib/gatewayClient.ts` for the `widenAuthorizationValidity` workaround needed
for Circle's current facilitator minimum validity requirement.

## Note on TypeScript

`server.js` is plain JavaScript — the rest of the codebase is TypeScript.
Converting it is on the backlog. Until then, types are documented in JSDoc comments
and enforced via `node --check` in CI.
