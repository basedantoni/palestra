import { CATEGORY_COLORS, type CategoryColor } from "@life-tracker/shared";

/**
 * Bank Category → seed category mapping (KOI-107).
 *
 * Gives the finance module a non-empty starting set of user-owned categories
 * and the user's starting Bank Category mapping (KOI-335). Pure. Names are only
 * used to seed: once seeded, the mapping holds categories by id, so the user
 * can rename, delete or remap freely.
 */

/** The 16 Bank Categories (Plaid's personal finance category, primary level). */
export const PFC_PRIMARIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
] as const;

const PFC_TO_NAME: Record<string, string> = {
  INCOME: "Income",
  TRANSFER_IN: "Transfers",
  TRANSFER_OUT: "Transfers",
  LOAN_PAYMENTS: "Loan Payments",
  BANK_FEES: "Bank Fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food & Drink",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Medical",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Government & Non-Profit",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Rent & Utilities",
};

/** Distinct seed category names (order is the suggested display order). */
export const SEED_CATEGORIES: string[] = [
  "Income",
  "Transfers",
  "Food & Drink",
  "Shopping",
  "Transportation",
  "Rent & Utilities",
  "Home",
  "Entertainment",
  "Travel",
  "Medical",
  "Personal Care",
  "Services",
  "Loan Payments",
  "Bank Fees",
  "Government & Non-Profit",
];

/**
 * Seed colors (KOI-336): the expense seeds take the palette in order, so each
 * is distinct. Income and Transfers get none; they leave in KOI-341. The
 * KOI-336 migration backfilled existing users with the same colors.
 */
export function seedCategoryColor(name: string): CategoryColor | null {
  if (name === "Income" || name === "Transfers") return null;
  return CATEGORY_COLORS[SEED_CATEGORIES.indexOf(name) - 2] ?? null;
}

/**
 * The seed category name for a Bank Category, or null when it can't be
 * mapped: the transaction is then Uncategorized (no category), never put in a
 * category named "Uncategorized" (KOI-301).
 */
export function categoryNameForPfc(pfcPrimary: string | null | undefined): string | null {
  if (!pfcPrimary) return null;
  return PFC_TO_NAME[pfcPrimary] ?? null;
}

/** The starting Bank Category mapping: every Bank Category → the user's category of its seed name, else null. */
export function seedBankCategoryMapping(categoryByName: ReadonlyMap<string, string>): Map<string, string | null> {
  return new Map(PFC_PRIMARIES.map((pfc) => [pfc, categoryByName.get(categoryNameForPfc(pfc)!) ?? null]));
}
