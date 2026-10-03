/**
 * Pure Net Worth history (KOI-293), per GLOSSARY.md (Net Worth, Balance
 * Snapshot) and ADR 0003.
 */
import { addDays, addWeeks } from "date-fns";

import { cents } from "./cash-flow";
import { isoWeekKey, toDateString } from "./date-utils";

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
  /** Monday of the ISO week, "yyyy-MM-dd". */
  weekStart: string;
  netWorth: number;
  assets: number;
  /** Total owed, positive. */
  liabilities: number;
  /** Some linked account's first snapshot comes after this point (missing, not $0). */
  partial: boolean;
}

const LIABILITY: ReadonlySet<AccountType> = new Set(["credit", "loan"]);

const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

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

export function netWorthHistory(
  accounts: NetWorthAccount[],
  snapshots: NetWorthSnapshot[],
): { points: NetWorthPoint[]; current: number | null; change30d: number | null } {
  const history = snapshotsByAccount(snapshots, accounts.map((a) => a.id));

  const days = [...history.values()].flat().map((s) => s.asOfDate).toSorted();
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return { points: [], current: null, change30d: null };

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

  // ponytail: findLast per account per week is O(weeks x snapshots); fine for years of daily data.
  const points: NetWorthPoint[] = [];
  for (let week = parseDay(isoWeekKey(parseDay(first))); toDateString(week) <= last; week = addWeeks(week, 1)) {
    // Sunday ends the ISO week; carry-forward makes it equal to the week's last available day.
    points.push({ weekStart: toDateString(week), ...at(toDateString(addDays(week, 6))) });
  }

  // Before any snapshot (or before an account was linked) the baseline is partial: no change, not a fake gain.
  const current = at(last).netWorth;
  const monthAgo = at(toDateString(addDays(parseDay(last), -30)));
  return { points, current, change30d: monthAgo.partial ? null : cents(current - monthAgo.netWorth) };
}
