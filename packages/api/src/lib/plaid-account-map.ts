/**
 * Pure mappers from Plaid's account shape to our `financial_account` rows.
 *
 * Typed against a minimal local interface (not the Plaid SDK) so the transform
 * stays unit-testable with plain fixtures and carries no runtime SDK dependency.
 */

export type AccountType = "depository" | "credit" | "investment" | "loan";

/** Minimal subset of Plaid's `AccountBase` we consume. */
export interface PlaidAccountInput {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances?: {
    current?: number | null;
    available?: number | null;
    iso_currency_code?: string | null;
  };
}

export interface FinancialAccountRow {
  userId: string;
  plaidItemId: string;
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: AccountType;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
}

const KNOWN_TYPES: ReadonlySet<AccountType> = new Set([
  "depository",
  "credit",
  "investment",
  "loan",
]);

/**
 * Collapse Plaid's account `type` onto our enum. Plaid emits `brokerage`
 * (→ investment) and `other`; anything outside our four values falls back to
 * `depository` so a row is never dropped on an unexpected type.
 */
export function mapPlaidAccountType(plaidType: string): AccountType {
  if (KNOWN_TYPES.has(plaidType as AccountType)) {
    return plaidType as AccountType;
  }
  if (plaidType === "brokerage") {
    return "investment";
  }
  return "depository";
}

export function plaidAccountToRow(
  account: PlaidAccountInput,
  ctx: { userId: string; plaidItemId: string },
): FinancialAccountRow {
  const balances = account.balances ?? {};
  return {
    userId: ctx.userId,
    plaidItemId: ctx.plaidItemId,
    plaidAccountId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type: mapPlaidAccountType(account.type),
    subtype: account.subtype ?? null,
    currentBalance: balances.current ?? null,
    availableBalance: balances.available ?? null,
    isoCurrencyCode: balances.iso_currency_code ?? null,
  };
}
