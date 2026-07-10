/**
 * Plaid Personal Finance Category (primary) → seed category mapping (KOI-107).
 *
 * Gives the finance module a non-empty starting set of user-owned categories
 * and auto-assigns each imported transaction by mapping its PFC primary. Pure;
 * the seeding routine and per-transaction assignment both call this.
 */

/** The 16 Plaid PFC primary values. */
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
  "Uncategorized",
];

export function categoryNameForPfc(pfcPrimary: string | null | undefined): string {
  if (!pfcPrimary) return "Uncategorized";
  return PFC_TO_NAME[pfcPrimary] ?? "Uncategorized";
}
