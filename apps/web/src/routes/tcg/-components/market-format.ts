/** Market Price display formats shared by tile prices and the Printing drawer. */

/** `amount` in `currency`, to the cent: "$35.90", "€10.00". */
export const money = (currency: string, amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "Oct 2" for a YYYY-MM-DD day. */
export const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
