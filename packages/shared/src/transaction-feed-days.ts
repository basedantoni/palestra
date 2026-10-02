/**
 * Shapes the transaction feed into day groups (KOI-277/279): each day lists
 * its transactions with that day's spend, and the two legs of a matched
 * internal transfer collapse into one entry.
 */

export type FeedRow = {
  id: string;
  /** ISO timestamp; Plaid dates are stored as UTC midnight of the bank's date. */
  date: string;
  /** Plaid sign: positive = money out. */
  amount: number;
  flow: "income" | "expense" | "transfer" | null;
  excluded: boolean;
  transferPairId: string | null;
};

export type FeedEntry<T extends FeedRow> =
  | { kind: "txn"; txn: T }
  /** `out` left the source account (amount > 0); `in` arrived in the other. */
  | { kind: "pair"; out: T; in: T };

export type FeedDay<T extends FeedRow> = {
  date: string; // YYYY-MM-DD
  /**
   * Non-excluded expense spend for the day — the budget rule. Null when the
   * day may continue past the loaded rows, so a partial total isn't shown.
   */
  spent: number | null;
  entries: FeedEntry<T>[];
};

/**
 * Group rows (already sorted newest first) under their bank calendar day.
 * A transfer pair sits where its first leg appears; a leg whose partner isn't
 * among `rows` (e.g. not loaded yet) stays a plain row. Pass
 * `complete: false` when more (older) rows exist beyond `rows`.
 */
export function buildFeedDays<T extends FeedRow>(
  rows: T[],
  { complete = true }: { complete?: boolean } = {},
): FeedDay<T>[] {
  const legsByPair = new Map<string, T[]>();
  for (const r of rows) {
    if (r.transferPairId) legsByPair.set(r.transferPairId, [...(legsByPair.get(r.transferPairId) ?? []), r]);
  }

  const days: Array<FeedDay<T> & { spent: number }> = [];
  const placedPairs = new Set<string>();
  for (const txn of rows) {
    const date = txn.date.slice(0, 10);
    let day = days.at(-1);
    if (!day || day.date !== date) {
      day = { date, spent: 0, entries: [] };
      days.push(day);
    }
    if (txn.flow === "expense" && !txn.excluded) day.spent += txn.amount;

    const legs = txn.transferPairId ? legsByPair.get(txn.transferPairId)! : [];
    const out = legs.find((l) => l.amount > 0);
    const inLeg = legs.find((l) => l.amount < 0);
    if (txn.transferPairId && out && inLeg) {
      if (!placedPairs.has(txn.transferPairId)) {
        placedPairs.add(txn.transferPairId);
        day.entries.push({ kind: "pair", out, in: inLeg });
      }
      continue;
    }
    day.entries.push({ kind: "txn", txn });
  }
  // A day can end up empty when its only rows were second legs placed earlier.
  const result: FeedDay<T>[] = days.filter((d) => d.entries.length > 0);
  const last = result.at(-1);
  if (!complete && last) last.spent = null;
  return result;
}
