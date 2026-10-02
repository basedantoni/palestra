/**
 * Pure Net Worth history (KOI-293), per GLOSSARY.md (Net Worth, Balance
 * Snapshot) and ADR 0003.
 */
import { addDays, addWeeks } from "date-fns";

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
  /** Some linked account has no snapshot yet at this point (missing, not $0). */
  partial: boolean;
}

const LIABILITY: ReadonlySet<AccountType> = new Set(["credit", "loan"]);

/** Float sums drift (0.1 + 0.2); money is shown to the cent. */
const cents = (n: number) => Math.round(n * 100) / 100;

const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

export function netWorthHistory(
  accounts: NetWorthAccount[],
  snapshots: NetWorthSnapshot[],
): { points: NetWorthPoint[]; current: number | null; change30d: number | null } {
  // Each linked account's snapshots, oldest first. Snapshots of unlinked accounts are dropped.
  const history = new Map(accounts.map((a) => [a.id, [] as NetWorthSnapshot[]]));
  for (const s of snapshots) history.get(s.accountId)?.push(s);
  for (const list of history.values()) list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  const days = [...history.values()].flat().map((s) => s.asOfDate).toSorted();
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return { points: [], current: null, change30d: null };

  /** Net Worth on `day`, carrying each account's last snapshot on or before it forward. */
  const at = (day: string) => {
    let assets = 0;
    let liabilities = 0;
    let partial = false;
    for (const a of accounts) {
      const snap = history.get(a.id)!.findLast((s) => s.asOfDate <= day);
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
