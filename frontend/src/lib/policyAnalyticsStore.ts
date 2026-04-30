export interface PolicyAnalyticsEntry {
  id: string;
  completedAt: number;
  coverageUsdc: string;
  durationSeconds: number;
  /** Seconds spent in At Desk mode (lower-risk, protected state). */
  atDeskSeconds: number;
  /** Seconds spent in On the Move mode (higher-risk). */
  onTheMoveSeconds: number;
  /** atDeskSeconds / durationSeconds, formatted to 3 decimal places. */
  protectedProportion: string;
  /** Stable browser session UUID — groups policies from the same browser. */
  userId: string;
  /** Number of chargingchange events fired during the session (plug/unplug switches). */
  switchCount: number;
}

const STORAGE_KEY = 'blink_policy_analytics_v1';
const MAX_ENTRIES = 100;

function loadFromStorage(): PolicyAnalyticsEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PolicyAnalyticsEntry[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(data: PolicyAnalyticsEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors — in-memory state still works.
  }
}

const entries: PolicyAnalyticsEntry[] = loadFromStorage();

export function pushPolicyAnalytics(entry: PolicyAnalyticsEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  saveToStorage(entries);
}

export function getPolicyAnalytics(): readonly PolicyAnalyticsEntry[] {
  return entries;
}

export function clearPolicyAnalytics(): void {
  entries.length = 0;
  localStorage.removeItem(STORAGE_KEY);
}
