import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { getPolicyAnalytics } from '@/lib/policyAnalyticsStore';
import { computeM } from '@/lib/rulebookV2';

interface PricingModel {
  k: number;
  x_expected: number;
  base_price_usdc_per_sec: number;
  m: number;
}

interface Recommendation {
  k_candidate: number;
  m_candidate: number;
  x_observed: number;
  change_pct_k: number;
  change_pct_m: number;
  recommendation: 'adjust' | 'monitor' | 'reject';
  severity: 'low' | 'moderate' | 'high';
  explanation: string;
}

const BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildRecommendation(current: PricingModel): Recommendation | null {
  const entries = getPolicyAnalytics();
  if (entries.length === 0) return null;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const window = entries.filter(e => e.completedAt >= cutoff);
  const pool = window.length > 0 ? window : entries;

  const x_observed =
    pool.reduce((sum, e) => sum + parseFloat(e.protectedProportion), 0) / pool.length;

  const delta = x_observed - current.x_expected;
  const k_candidate = clamp(current.k - 0.3 * delta, 0.5, 1.5);
  const m_candidate = clamp(computeM(k_candidate, x_observed), 0.5, 3.0);

  const change_pct_k = (Math.abs(k_candidate - current.k) / current.k) * 100;
  const change_pct_m = (Math.abs(m_candidate - current.m) / current.m) * 100;
  const maxChange = Math.max(change_pct_k, change_pct_m);

  const recommendation: Recommendation['recommendation'] =
    maxChange > 25 ? 'reject' : maxChange > 10 ? 'monitor' : 'adjust';
  const severity: Recommendation['severity'] =
    maxChange > 25 ? 'high' : maxChange > 10 ? 'moderate' : 'low';

  const direction = delta > 0 ? 'more plugged in' : 'less plugged in';
  const explanation =
    `Users are ${direction} than expected (observed ${(x_observed * 100).toFixed(1)}% vs assumed ${(current.x_expected * 100).toFixed(1)}%). ` +
    `Proposed adjustment: k ${current.k.toFixed(3)} → ${k_candidate.toFixed(3)}, m ${current.m.toFixed(3)} → ${m_candidate.toFixed(3)} ` +
    `(${change_pct_k.toFixed(1)}% / ${change_pct_m.toFixed(1)}% change). ` +
    (recommendation === 'reject'
      ? 'Change exceeds 25% — major remodelling required before applying.'
      : recommendation === 'monitor'
      ? 'Change is material (10–25%) — monitor further before applying.'
      : 'Change is within safe bounds — ready to apply.');

  return { k_candidate, m_candidate, x_observed, change_pct_k, change_pct_m, recommendation, severity, explanation };
}

const REC_COLOUR = { adjust: '#22c55e', monitor: '#f59e0b', reject: '#ef4444' };
const SEV_COLOUR = { low: '#22c55e', moderate: '#f59e0b', high: '#ef4444' };

export default function PricingOptimiser() {
  const [model, setModel] = useState<PricingModel | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/admin/pricing`)
      .then(r => r.json())
      .then((d: PricingModel) => {
        setModel(d);
        setRec(buildRecommendation(d));
      })
      .catch(() => {});
  }, []);

  const handleAccept = useCallback(async () => {
    if (!model || !rec) return;
    setAccepting(true);
    try {
      const res = await fetch(`${BACKEND}/admin/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: rec.k_candidate, x_expected: rec.x_observed }),
      });
      const body = await res.json() as PricingModel & { error?: string };
      if (!res.ok || body.error) {
        setToast(`Failed: ${body.error ?? res.status}`);
        return;
      }
      setModel(body);
      setRec(null);
      setDismissed(false);
      setToast('Pricing model updated.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Network error');
    } finally {
      setAccepting(false);
      setTimeout(() => setToast(''), 5000);
    }
  }, [model, rec]);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-bebas text-2xl tracking-widest text-[#f0f0f0]">
          Pricing Optimisation
        </h2>
        <span className="font-dm-mono text-xs text-[#555555] uppercase tracking-widest">
          k·x + m·(1-x) = 1 normalised model
        </span>
      </div>

      {toast && (
        <div className="mb-3 px-4 py-2 border border-[#e8a020]/40 bg-[#0e0e0e] text-xs font-dm-mono text-[#e8a020]">
          {toast}
        </div>
      )}

      <div className="border border-[#1a1a1a] bg-[#0e0e0e]">
        <div className="px-4 py-2 border-b border-[#1a1a1a]">
          <span className="text-[10px] uppercase tracking-widest text-[#666666] font-dm-mono">
            Current Model
          </span>
        </div>
        {model ? (
          <div className="px-4 py-4 grid grid-cols-4 gap-6 font-dm-mono">
            <Stat label="k (at-desk)" value={model.k.toFixed(3)} />
            <Stat label="m (on-the-move)" value={model.m.toFixed(3)} />
            <Stat label="x expected" value={`${(model.x_expected * 100).toFixed(0)}%`} />
            <Stat
              label="base rate"
              value={`${(model.base_price_usdc_per_sec * 1e6).toFixed(1)} µUSDC/s`}
            />
          </div>
        ) : (
          <div className="px-4 py-4 text-xs text-[#555555] font-dm-mono">Loading…</div>
        )}
      </div>

      {model && rec && !dismissed && (
        <div className="mt-4 border border-[#1a1a1a] bg-[#0e0e0e]">
          <div className="px-4 py-2 border-b border-[#1a1a1a] flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-[#666666] font-dm-mono">
              Recommendation
            </span>
            <span
              className="font-dm-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border"
              style={{ color: REC_COLOUR[rec.recommendation], borderColor: `${REC_COLOUR[rec.recommendation]}44` }}
            >
              {rec.recommendation}
            </span>
            <span
              className="font-dm-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border"
              style={{ color: SEV_COLOUR[rec.severity], borderColor: `${SEV_COLOUR[rec.severity]}44` }}
            >
              {rec.severity} severity
            </span>
          </div>

          <div className="px-4 py-4 grid grid-cols-2 gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#555555] font-dm-mono mb-3">
                Current
              </div>
              <div className="grid grid-cols-2 gap-3 font-dm-mono">
                <Stat label="k" value={model.k.toFixed(3)} />
                <Stat label="m" value={model.m.toFixed(3)} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#e8a020] font-dm-mono mb-3">
                Suggested
              </div>
              <div className="grid grid-cols-2 gap-3 font-dm-mono">
                <Stat
                  label="k"
                  value={rec.k_candidate.toFixed(3)}
                  delta={`${rec.change_pct_k > 0 ? '+' : ''}${(rec.k_candidate - model.k > 0 ? '+' : '')}${(rec.k_candidate - model.k).toFixed(3)} (${rec.change_pct_k.toFixed(1)}%)`}
                />
                <Stat
                  label="m"
                  value={rec.m_candidate.toFixed(3)}
                  delta={`${rec.m_candidate - model.m > 0 ? '+' : ''}${(rec.m_candidate - model.m).toFixed(3)} (${rec.change_pct_m.toFixed(1)}%)`}
                />
              </div>
            </div>
          </div>

          <div className="px-4 pb-3 text-xs text-[#888888] leading-relaxed">
            {rec.explanation}
          </div>

          <div className="px-4 pb-4 flex gap-3">
            <button
              type="button"
              onClick={handleAccept}
              disabled={accepting || rec.recommendation === 'reject'}
              className="flex items-center gap-2 bg-[#e8a020] disabled:bg-[#1a1a1a] disabled:text-[#444444] text-[#080808] font-dm-mono uppercase text-xs tracking-widest px-4 py-2 hover:bg-[#f5b530] transition-colors"
            >
              <CheckCircle className="h-3 w-3" />
              Accept
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex items-center gap-2 border border-[#1a1a1a] text-[#888888] font-dm-mono uppercase text-xs tracking-widest px-4 py-2 hover:border-[#666666] hover:text-[#f0f0f0] transition-colors"
            >
              <XCircle className="h-3 w-3" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex items-center gap-2 border border-[#1a1a1a] text-[#666666] font-dm-mono uppercase text-xs tracking-widest px-4 py-2 hover:border-[#444444] hover:text-[#888888] transition-colors"
            >
              <Clock className="h-3 w-3" />
              Defer
            </button>
          </div>
        </div>
      )}

      {model && !rec && (
        <div className="mt-4 border border-[#1a1a1a] bg-[#0e0e0e] px-4 py-6 text-center text-[#555555] font-dm-mono text-xs uppercase tracking-widest">
          No recommendation — complete policy sessions in /live to generate pricing analysis
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[#555555] mb-1">{label}</div>
      <div className="text-lg text-[#f0f0f0] tabular-nums">{value}</div>
      {delta && (
        <div className="text-[10px] text-[#e8a020] mt-0.5">{delta}</div>
      )}
    </div>
  );
}
