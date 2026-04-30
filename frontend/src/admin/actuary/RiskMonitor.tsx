import { useMemo } from 'react';
import { getPolicyAnalytics } from '@/lib/policyAnalyticsStore';

interface RiskEntry {
  userId: string;
  switchCount: number;
  durationSeconds: number;
  anomalyScore: number;
  status: 'normal' | 'suspicious' | 'high_risk';
  reason: string;
  completedAt: number;
}

function computeEntry(entry: ReturnType<typeof getPolicyAnalytics>[number]): RiskEntry {
  const sc = entry.switchCount ?? 0;
  const anomalyScore = Math.min(sc / 6, 1);
  const status: RiskEntry['status'] =
    sc > 5 ? 'high_risk' : sc > 2 ? 'suspicious' : 'normal';
  const reason =
    sc === 0
      ? 'No charger state changes detected'
      : `Charger state changed ${sc} time${sc === 1 ? '' : 's'} in a ${entry.durationSeconds}s session`;
  return {
    userId: entry.userId ?? 'unknown',
    switchCount: sc,
    durationSeconds: entry.durationSeconds,
    anomalyScore,
    status,
    reason,
    completedAt: entry.completedAt,
  };
}

const STATUS_COLOUR: Record<RiskEntry['status'], string> = {
  normal: '#22c55e',
  suspicious: '#f59e0b',
  high_risk: '#ef4444',
};

const STATUS_LABEL: Record<RiskEntry['status'], string> = {
  normal: 'Normal',
  suspicious: 'Suspicious',
  high_risk: 'High Risk',
};

export default function RiskMonitor() {
  const entries = useMemo(() => {
    return getPolicyAnalytics()
      .map(computeEntry)
      .sort((a, b) => b.anomalyScore - a.anomalyScore);
  }, []);

  const flagged = entries.filter(e => e.status !== 'normal');

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-bebas text-2xl tracking-widest text-[#f0f0f0]">
          Risk Monitoring
        </h2>
        <span className="font-dm-mono text-xs text-[#666666] uppercase tracking-widest">
          {entries.length} session{entries.length !== 1 ? 's' : ''} · {flagged.length} flagged
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="border border-[#1a1a1a] bg-[#0e0e0e] px-4 py-8 text-center text-[#555555] font-dm-mono text-xs uppercase tracking-widest">
          No session data — complete a policy session in /live to populate risk analysis
        </div>
      ) : (
        <div className="border border-[#1a1a1a] bg-[#0e0e0e]">
          <div className="px-4 py-2 border-b border-[#1a1a1a] grid grid-cols-[1fr_auto_auto_auto_1fr] gap-4 text-[10px] uppercase tracking-widest text-[#555555] font-dm-mono">
            <span>Session</span>
            <span className="text-right">Switches</span>
            <span className="text-right">Score</span>
            <span>Status</span>
            <span>Reason</span>
          </div>
          <ul className="divide-y divide-[#1a1a1a]">
            {entries.map((e, i) => (
              <li
                key={`${e.userId}-${e.completedAt}-${i}`}
                className="px-4 py-3 grid grid-cols-[1fr_auto_auto_auto_1fr] gap-4 items-center"
              >
                <span className="font-dm-mono text-xs text-[#888888] truncate">
                  {e.userId.slice(0, 8)}…
                </span>
                <span
                  className="font-dm-mono text-sm tabular-nums text-right"
                  style={{ color: e.switchCount > 0 ? '#f0f0f0' : '#555555' }}
                >
                  {e.switchCount}
                </span>
                <span className="font-dm-mono text-sm tabular-nums text-right text-[#888888]">
                  {e.anomalyScore.toFixed(2)}
                </span>
                <span
                  className="font-dm-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border"
                  style={{
                    color: STATUS_COLOUR[e.status],
                    borderColor: `${STATUS_COLOUR[e.status]}44`,
                  }}
                >
                  {STATUS_LABEL[e.status]}
                </span>
                <span className="text-xs text-[#666666] truncate">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
