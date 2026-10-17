/**
 * Pure Net Worth history (KOI-293), per GLOSSARY.md (Net Worth, Balance
 * Snapshot) and ADR 0003.
 */
import { addDays, subMonths } from "date-fns";

import { cents } from "./cash-flow";
import { toDateString } from "./date-utils";

export type AccountType = "depository" | "credit" | "investment" | "loan";

export interface NetWorthAccount {
  id: string;
  type: AccountType;
}

/** One Balance Snapshot. Plaid convention: credit/loan balances are positive amounts owed. */
export interface NetWorthSnapshot {
  accountId: string;
  /** "yyyy-MM-dd" */
  asOfDate: string;
  balance: number;
}

export interface NetWorthPoint {
  /** "yyyy-MM-dd" */
  date: string;
  netWorth: number;
  assets: number;
  /** Total owed, positive. */
  liabilities: number;
  /** Some linked account's first snapshot comes after this point (missing, not $0). */
  partial: boolean;
}

const LIABILITY: ReadonlySet<AccountType> = new Set(["credit", "loan"]);

/**
 * An account's balance with its pending transactions folded in. Plaid's
 * `current` counts only posted transactions while the transaction list shows
 * pending ones too. Plaid sign: positive = money out, so a pending outflow
 * lowers an asset and raises what a credit/loan owes. Missing stays missing.
 */
export function balanceWithPending(
  type: AccountType,
  current: number | null,
  pending: number,
): number | null {
  if (current === null) return null;
  return cents(LIABILITY.has(type) ? current + pending : current - pending);
}

const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

/** Balance chart chips, as Copilot draws them (research §3.3). */
export const TIMEFRAMES = ["1M", "3M", "YTD", "1Y", "All"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const MONTHS_BACK = { "1M": 1, "3M": 3, "1Y": 12 } as const;

/**
 * First day ("yyyy-MM-dd") a chip's window plots, `today` included. 1M/3M/1Y
 * go back N months (clamped to the shorter month's end, so Mar 31 → Feb 28)
 * then forward a day; YTD is Jan 1; All is null: it starts at the first snapshot.
 */
export function timeframeStart(timeframe: Timeframe, today: string): string | null {
  if (timeframe === "All") return null;
  if (timeframe === "YTD") return `${today.slice(0, 4)}-01-01`;
  return toDateString(addDays(subMonths(parseDay(today), MONTHS_BACK[timeframe]), 1));
}

/** Each of `accountIds`' snapshots, oldest first; snapshots of other accounts are dropped. */
function snapshotsByAccount(snapshots: NetWorthSnapshot[], accountIds: Iterable<string>) {
  const history = new Map([...accountIds].map((id) => [id, [] as NetWorthSnapshot[]]));
  for (const s of snapshots) history.get(s.accountId)?.push(s);
  for (const list of history.values()) list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  return history;
}

/** Carry-forward: an account's balance on `day` is its last snapshot on or before it. */
const balanceAsOf = (history: NetWorthSnapshot[], day: string) => history.findLast((s) => s.asOfDate <= day);

/**
 * Total balance of the given snapshots' accounts on each snapshot day, carrying
 * each account's last balance forward (an account counts from its first
 * snapshot on). Used for Savings Goal progress.
 */
export function carryForwardSeries(snapshots: NetWorthSnapshot[]): Array<{ asOfDate: string; balance: number }> {
  const history = snapshotsByAccount(snapshots, new Set(snapshots.map((s) => s.accountId)));
  const days = [...new Set(snapshots.map((s) => s.asOfDate))].toSorted();
  // ponytail: O(days x snapshots) like netWorthHistory; fine for a goal's few accounts.
  return days.map((asOfDate) => {
    let balance = 0;
    for (const list of history.values()) balance += balanceAsOf(list, asOfDate)?.balance ?? 0;
    return { asOfDate, balance: cents(balance) };
  });
}

/** Inclusive day range; `from` null starts at the first snapshot (the All chip). */
export interface DayWindow {
  from: string | null;
  to: string;
}

/**
 * Daily Net Worth over `window`: one point per day, no downsampling. `change`
 * is current minus the window's first point, null when that point is partial.
 */
export function netWorthHistory(
  accounts: NetWorthAccount[],
  snapshots: NetWorthSnapshot[],
  window: DayWindow,
): { points: NetWorthPoint[]; current: number | null; change: number | null } {
  const history = snapshotsByAccount(snapshots, accounts.map((a) => a.id));

  const first = [...history.values()].flat().map((s) => s.asOfDate).toSorted()[0];
  if (!first) return { points: [], current: null, change: null };

  // Accounts never snapshotted (e.g. Plaid null balance) neither count nor mark partial.
  const tracked = accounts.filter((a) => history.get(a.id)!.length > 0);

  /** Net Worth on `day`, carrying each account's last snapshot on or before it forward. */
  const at = (day: string) => {
    let assets = 0;
    let liabilities = 0;
    let partial = false;
    for (const a of tracked) {
      const snap = balanceAsOf(history.get(a.id)!, day);
      if (!snap) partial = true;
      else if (LIABILITY.has(a.type)) liabilities += snap.balance;
      else assets += snap.balance;
    }
    return { netWorth: cents(assets - liabilities), assets: cents(assets), liabilities: cents(liabilities), partial };
  };

  // ponytail: findLast per account per day is O(days x snapshots), ~4M steps for 1Y of 10 accounts;
  // walk a cursor per account if All over many years gets slow.
  const points: NetWorthPoint[] = [];
  const start = window.from && window.from > first ? window.from : first;
  for (let d = parseDay(start); toDateString(d) <= window.to; d = addDays(d, 1)) {
    points.push({ date: toDateString(d), ...at(toDateString(d)) });
  }

  // A partial baseline (an account not linked yet) gives no change, not a fake gain.
  const base = points[0];
  const current = points.at(-1)?.netWorth ?? null;
  const change = base && !base.partial && current !== null ? cents(current - base.netWorth) : null;
  return { points, current, change };
}

/**
 * One account's daily balance over `window`, as its Balance Snapshots report it
 * (a credit/loan balance is the positive amount owed). `change` is measured
 * from the window's first point.
 */
export function accountBalanceHistory(
  account: NetWorthAccount,
  snapshots: NetWorthSnapshot[],
  window: DayWindow,
): { points: Array<{ date: string; balance: number }>; current: number | null; change: number | null } {
  const owed = LIABILITY.has(account.type);
  const points = netWorthHistory([account], snapshots, window).points.map((p) => ({
    date: p.date,
    balance: owed ? p.liabilities : p.assets,
  }));
  const first = points[0]?.balance;
  const current = points.at(-1)?.balance ?? null;
  return { points, current, change: first === undefined || current === null ? null : cents(current - first) };
}
