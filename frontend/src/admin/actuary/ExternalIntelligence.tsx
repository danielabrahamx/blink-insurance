import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';

interface Issue {
  title: string;
  frequency: 'low' | 'medium' | 'high';
  severity: 'low' | 'medium' | 'high';
  sources_count: number;
}

interface InvestigationData {
  product: string;
  issues: Issue[];
  trend: 'increasing' | 'stable' | 'decreasing';
  confidence_score: number;
}

interface Investigation {
  data: InvestigationData;
  fetchedAt: number;
}

const BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

const BADGE_COLOUR: Record<'low' | 'medium' | 'high', string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

const TREND_LABEL = {
  increasing: 'Trend: Increasing',
  stable: 'Trend: Stable',
  decreasing: 'Trend: Decreasing',
};

export default function ExternalIntelligence() {
  const [result, setResult] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/admin/actuary/investigation`)
      .then(r => r.json())
      .then((d: Investigation | null) => { if (d) setResult(d); })
      .catch(() => {});
  }, []);

  const conduct = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/admin/actuary/investigate`, { method: 'POST' });
      const body = await res.json() as Investigation & { error?: string };
      if (!res.ok || body.error) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-bebas text-2xl tracking-widest text-[#f0f0f0]">
          External Intelligence
        </h2>
        {result && (
          <span className="font-dm-mono text-xs text-[#555555] uppercase tracking-widest">
            Last run {new Date(result.fetchedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="border border-[#1a1a1a] bg-[#0e0e0e]">
        <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#666666] font-dm-mono">
            MacBook hardware &amp; battery issues · multi-source aggregation
          </span>
          <button
            type="button"
            onClick={conduct}
            disabled={loading}
            className="flex items-center gap-2 bg-[#e8a020] disabled:bg-[#1a1a1a] disabled:text-[#444444] text-[#080808] font-dm-mono uppercase text-xs tracking-widest px-4 py-2 hover:bg-[#f5b530] transition-colors"
          >
            {loading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {loading ? 'Investigating…' : 'Conduct Investigation'}
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 text-xs text-[#ef4444] font-dm-mono border-b border-[#1a1a1a]">
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="px-4 py-8 text-center text-[#555555] font-dm-mono text-xs uppercase tracking-widest">
            No investigation data — click Conduct Investigation to search for known issues
          </div>
        )}

        {loading && (
          <div className="px-4 py-8 text-center text-[#666666] font-dm-mono text-xs uppercase tracking-widest">
            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-3" />
            Searching web sources… this may take 20–30s
          </div>
        )}

        {result && !loading && (
          <>
            <ul className="divide-y divide-[#1a1a1a]">
              {result.data.issues.map((issue, i) => (
                <li key={i} className="px-4 py-3 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#f0f0f0] leading-snug">{issue.title}</div>
                    <div className="text-[10px] text-[#555555] font-dm-mono mt-1 uppercase tracking-widest">
                      {issue.sources_count} source{issue.sources_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    <Badge label={`freq: ${issue.frequency}`} colour={BADGE_COLOUR[issue.frequency]} />
                    <Badge label={`sev: ${issue.severity}`} colour={BADGE_COLOUR[issue.severity]} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="px-4 py-3 border-t border-[#1a1a1a] flex items-center gap-6 font-dm-mono text-xs text-[#666666]">
              <span className="uppercase tracking-widest">
                {TREND_LABEL[result.data.trend]}
              </span>
              <span className="uppercase tracking-widest">
                Confidence: {(result.data.confidence_score * 100).toFixed(0)}%
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Badge({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      className="font-dm-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border"
      style={{ color: colour, borderColor: `${colour}44` }}
    >
      {label}
    </span>
  );
}
