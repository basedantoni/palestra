/**
 * Pure savings-goal projection (KOI-108, Seam 3).
 *
 * Balance-driven: progress is the latest account balance; on-track / projected
 * completion is extrapolated from the saving rate over the balance snapshots.
 * No DB/HTTP — operates on a snapshot array.
 */

export interface BalancePoint {
  /** YYYY-MM-DD. */
  asOfDate: string;
  balance: number;
}

export interface GoalProjection {
  currentBalance: number;
  percent: number;
  complete: boolean;
  /** Saving rate in currency/day over the snapshot window (0 if not increasing). */
  ratePerDay: number;
  /** YYYY-MM-DD, or null when it can't be projected (flat/negative rate, <2 points). */
  projectedDate: string | null;
  /** true/false when a targetDate is given and projectable; null otherwise. */
  onTrack: boolean | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDiff(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + Math.ceil(days) * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function projectGoal(args: {
  snapshots: BalancePoint[];
  target: number;
  targetDate?: string;
}): GoalProjection {
  const { snapshots, target, targetDate } = args;
  const sorted = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const last = sorted[sorted.length - 1];
  const currentBalance = last?.balance ?? 0;
  const percent = target > 0 ? Math.min(100, (currentBalance / target) * 100) : 0;
  const complete = currentBalance >= target;

  if (complete) {
    return {
      currentBalance,
      percent: 100,
      complete: true,
      ratePerDay: 0,
      projectedDate: last ? last.asOfDate : null,
      onTrack: true,
    };
  }

  let ratePerDay = 0;
  if (sorted.length >= 2) {
    const first = sorted[0];
    const days = dayDiff(first.asOfDate, last.asOfDate);
    if (days > 0) {
      ratePerDay = Math.max(0, (last.balance - first.balance) / days);
    }
  }

  if (ratePerDay <= 0) {
    return { currentBalance, percent, complete: false, ratePerDay: 0, projectedDate: null, onTrack: null };
  }

  const remaining = target - currentBalance;
  const projectedDate = addDays(last.asOfDate, remaining / ratePerDay);
  const onTrack = targetDate ? projectedDate <= targetDate : null;

  return { currentBalance, percent, complete: false, ratePerDay, projectedDate, onTrack };
}
