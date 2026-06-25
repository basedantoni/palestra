/**
 * Pure transform from a Plaid `/transactions/sync` delta to domain mutations.
 *
 * This is the primary test seam for finance ingestion (KOI-105): given a
 * recorded Plaid sync response it yields the transaction upserts/deletes,
 * account balance updates, and daily balance snapshots to persist — with no
 * DB or HTTP. Flow classification, category seeding, and transfer
 * pair-matching are layered on in later slices and are intentionally NOT done
 * here (raw `plaidCategory*` is retained for them).
 *
 * Typed against minimal local interfaces, not the Plaid SDK, so the transform
 * stays fixture-testable.
 */

export interface PlaidTransactionInput {
  transaction_id: string;
  account_id: string;
  amount: number;
  /** Posted/authorized date, YYYY-MM-DD. */
  date: string;
  name: string;
  merchant_name?: string | null;
  pending?: boolean | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  iso_currency_code?: string | null;
}

export interface PlaidAccountBalanceInput {
  account_id: string;
  balances?: {
    current?: number | null;
    available?: number | null;
    iso_currency_code?: string | null;
  };
}

export interface PlaidSyncDelta {
  added: PlaidTransactionInput[];
  modified: PlaidTransactionInput[];
  removed: Array<{ transaction_id: string }>;
  accounts: PlaidAccountBalanceInput[];
  /** Day the sync ran, YYYY-MM-DD, used as the snapshot key. */
  asOfDate: string;
}

export interface TransactionUpsert {
  plaidTransactionId: string;
  plaidAccountId: string;
  amount: number;
  date: Date;
  name: string;
  merchantName: string | null;
  pending: boolean;
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
  isoCurrencyCode: string | null;
}

export interface AccountBalanceUpdate {
  plaidAccountId: string;
  current: number | null;
  available: number | null;
  isoCurrencyCode: string | null;
}

export interface BalanceSnapshotRow {
  plaidAccountId: string;
  asOfDate: string;
  balance: number;
}

export interface SyncMutations {
  upserts: TransactionUpsert[];
  deletes: string[];
  accountBalances: AccountBalanceUpdate[];
  snapshots: BalanceSnapshotRow[];
}

function toUpsert(t: PlaidTransactionInput): TransactionUpsert {
  const pfc = t.personal_finance_category ?? null;
  return {
    plaidTransactionId: t.transaction_id,
    plaidAccountId: t.account_id,
    amount: t.amount,
    date: new Date(`${t.date}T00:00:00.000Z`),
    name: t.name,
    merchantName: t.merchant_name ?? null,
    pending: t.pending ?? false,
    plaidCategoryPrimary: pfc?.primary ?? null,
    plaidCategoryDetailed: pfc?.detailed ?? null,
    isoCurrencyCode: t.iso_currency_code ?? null,
  };
}

export function applyTransactionSyncDelta(delta: PlaidSyncDelta): SyncMutations {
  const upserts = [...delta.added, ...delta.modified].map(toUpsert);
  const deletes = delta.removed.map((r) => r.transaction_id);

  const accountBalances: AccountBalanceUpdate[] = [];
  const snapshots: BalanceSnapshotRow[] = [];

  for (const acct of delta.accounts) {
    const balances = acct.balances ?? {};
    const current = balances.current ?? null;
    accountBalances.push({
      plaidAccountId: acct.account_id,
      current,
      available: balances.available ?? null,
      isoCurrencyCode: balances.iso_currency_code ?? null,
    });
    if (current !== null) {
      snapshots.push({
        plaidAccountId: acct.account_id,
        asOfDate: delta.asOfDate,
        balance: current,
      });
    }
  }

  return { upserts, deletes, accountBalances, snapshots };
}
