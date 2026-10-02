/**
 * Time periods for filtering the finance transaction feed (KOI-276).
 *
 * All dates are calendar dates ("YYYY-MM-DD"): Plaid reports transactions by
 * the bank's calendar date, so only "today" depends on the user's timezone.
 */

export const TRANSACTION_PERIOD_PRESETS = ["90d", "6m", "ytd"] as const;
export type TransactionPeriodPreset = (typeof TRANSACTION_PERIOD_PRESETS)[number];

export const TRANSACTION_PERIOD_PRESET_LABELS: Record<TransactionPeriodPreset, string> = {
  "90d": "Last 90 days",
  "6m": "Last 6 months",
  ytd: "Year to date",
};

export type TransactionPeriod =
  | { kind: "month"; month: string } // YYYY-MM
  | { kind: "preset"; preset: TransactionPeriodPreset }
  | { kind: "all" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar-date arithmetic in UTC so local DST never shifts a day. */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}
function formatDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Same day-of-month `n` months earlier, clamped to that month's last day. */
function monthsBefore(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - n;
  const year = Math.floor(total / 12);
  const month1 = (total % 12) + 1;
  return `${year}-${pad(month1)}-${pad(Math.min(d, daysInMonth(year, month1)))}`;
}

/** Inclusive date bounds for a period, relative to `today` (YYYY-MM-DD). */
export function resolvePeriodBounds(
  period: TransactionPeriod,
  today: string,
): { from?: string; to?: string } {
  switch (period.kind) {
    case "all":
      return {};
    case "month": {
      const [year, month1] = period.month.split("-").map(Number) as [number, number];
      return { from: `${period.month}-01`, to: `${period.month}-${pad(daysInMonth(year, month1))}` };
    }
    case "preset":
      if (period.preset === "90d") return { from: addDays(today, -89), to: today };
      if (period.preset === "6m") return { from: addDays(monthsBefore(today, 6), 1), to: today };
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

const todayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date (YYYY-MM-DD) it currently is in `timeZone`. */
export function todayInTimeZone(now: Date, timeZone: string): string {
  let fmt = todayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    todayFormatters.set(timeZone, fmt);
  }
  // en-CA renders as "2026-09-30"
  return fmt.format(now);
}

/** The month (YYYY-MM) a period's range ends in; null for all time. */
function endMonth(period: TransactionPeriod, today: string): string | null {
  if (period.kind === "all") return null;
  if (period.kind === "month") return period.month;
  return today.slice(0, 7); // every preset ends today
}

/** Shift a YYYY-MM month key by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * The month `delta` steps from a period. Shortcuts step from the month their
 * range ends in. Never moves past the current month; all time is unchanged.
 */
export function stepPeriod(period: TransactionPeriod, delta: number, today: string): TransactionPeriod {
  const from = endMonth(period, today);
  if (from === null) return period;
  const target = addMonths(from, delta);
  const current = today.slice(0, 7);
  return { kind: "month", month: target > current ? current : target };
}

/** Whether › can move to a later month. */
export function canStepForward(period: TransactionPeriod, today: string): boolean {
  return period.kind === "month" && period.month < today.slice(0, 7);
}
