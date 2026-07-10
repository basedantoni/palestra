/**
 * Pure flow classification + internal-transfer pair-matching (KOI-106).
 *
 * Operates on already-synced transactions; no DB/HTTP. The drain's post-sync
 * step calls these to set `flow` and link transfer legs via `transferPairId`.
 */

export type TransactionFlow = "income" | "expense" | "transfer";

/**
 * Classify a transaction's money flow from its Plaid Personal Finance Category
 * primary. Per the PRD: INCOME → income, TRANSFER_IN/OUT → transfer, everything
 * else (and unknown) → expense. Internal transfers that Plaid miscategorizes
 * are still caught structurally by `matchInternalTransfers`.
 */
export function classifyFlow(pfcPrimary: string | null | undefined): TransactionFlow {
  if (pfcPrimary === "INCOME") return "income";
  if (pfcPrimary === "TRANSFER_IN" || pfcPrimary === "TRANSFER_OUT") return "transfer";
  return "expense";
}

export interface TransferCandidate {
  id: string;
  accountId: string;
  /** Plaid sign convention: positive = money out of the account. */
  amount: number;
  date: Date;
}

export interface TransferPair {
  transactionIds: [string, string];
}

/** Default matching window: legs of one transfer usually post within a few days. */
const DEFAULT_WINDOW_DAYS = 3;
const AMOUNT_EPSILON = 0.005;

/**
 * Link internal transfers: an outflow (amount > 0) on one account paired with
 * an equal-magnitude inflow (amount < 0) on a *different* account within the
 * date window. Greedy, each transaction used at most once.
 */
export function matchInternalTransfers(
  transactions: TransferCandidate[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): TransferPair[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const outflows = transactions.filter((t) => t.amount > 0);
  const inflows = transactions.filter((t) => t.amount < 0);
  const usedInflow = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outflows) {
    const match = inflows.find(
      (inf) =>
        !usedInflow.has(inf.id) &&
        inf.accountId !== out.accountId &&
        Math.abs(Math.abs(inf.amount) - out.amount) <= AMOUNT_EPSILON &&
        Math.abs(inf.date.getTime() - out.date.getTime()) <= windowMs,
    );
    if (match) {
      usedInflow.add(match.id);
      pairs.push({ transactionIds: [out.id, match.id] });
    }
  }

  return pairs;
}
