/** Whole-dollar USD, as the finance UI shows money. */
export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Rounded the way it is shown; `|| 0` turns -0 into 0 so it never prints "-$0". */
const shown = (n: number) => Math.round(n) || 0;

/** "+$1,200" / "-$300"; anything that rounds to zero is "$0". Sign comes from the rounded value. */
export function signedUsd(n: number): string {
  const r = shown(n);
  return (r > 0 ? "+" : "") + usd.format(r);
}

/** Whether `n` displays as a negative dollar amount (for red text). */
export const isNegativeUsd = (n: number) => shown(n) < 0;
