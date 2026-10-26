/**
 * Splits (ADR 0007): pure validation shared by the router and the split editor.
 * `amount` is `real`, so sums compare in integer cents.
 */
import type { TransactionFlow } from "./transaction-flow";

export const MIN_SPLIT_PIECES = 2;

/** What deciding whether a transaction can be split reads of it. */
export interface SplittableTransaction {
  amount: number;
  pending: boolean;
  flow: TransactionFlow | null;
  transferPairId: string | null;
  parentTransactionId: string | null;
}

export type SplitValidation = { ok: true } | { ok: false; reason: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const toCents = (amount: number): number => Math.round(amount * 100);

/** Why `txn` can't be split, or null: only posted expenses outside a Transfer Pair, and never a Split itself. */
export function splitIneligibility(txn: Omit<SplittableTransaction, "amount">): string | null {
  if (txn.parentTransactionId) return "A split piece can't be split again";
  if (txn.pending) return "Pending transactions can't be split until they post";
  if (txn.flow !== "expense") return "Only expenses can be split";
  if (txn.transferPairId) return "Matched transfers can't be split";
  return null;
}

/** What the pieces leave of the parent's amount, to the cent: negative when they overshoot. */
export function remainingToAssign(parentAmount: number, pieces: ReadonlyArray<{ amount: number }>): number {
  return (toCents(parentAmount) - pieces.reduce((sum, p) => sum + toCents(p.amount), 0)) / 100;
}

/** The hint the split editor shows until the pieces balance. */
export function remainingLabel(remaining: number): string {
  return remaining < 0 ? `${usd.format(-remaining)} over` : `${usd.format(remaining)} left to assign`;
}

/** A split of `parent` into `pieces` is valid when the parent is eligible, there are at least 2 pieces, and they sum to it. */
export function validateSplit(parent: SplittableTransaction, pieces: ReadonlyArray<{ amount: number }>): SplitValidation {
  const ineligible = splitIneligibility(parent);
  if (ineligible) return { ok: false, reason: ineligible };
  if (pieces.length < MIN_SPLIT_PIECES) return { ok: false, reason: `A split needs at least ${MIN_SPLIT_PIECES} pieces` };
  const remaining = remainingToAssign(parent.amount, pieces);
  if (remaining !== 0) {
    return { ok: false, reason: `Splits must add up to ${usd.format(parent.amount)} (${remainingLabel(remaining)})` };
  }
  return { ok: true };
}
