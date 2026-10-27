import type * as schema from "@life-tracker/db/schema/index";
import { exchangeRate } from "@life-tracker/db/schema/index";
import { desc, inArray, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { PerEur, RateRow } from "./ecb";

/**
 * The database the market jobs write to, passed in rather than imported: the worker builds it
 * from its own env (the web server's env module is never loaded there), tests pass PGlite.
 */
export type MarketDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Rows per statement: 3 params each, well under Postgres' 65,535 bind limit. */
const CHUNK = 5_000;

/** Replace every day present in `rows`, in one transaction: a re-run or replay leaves one set. */
export async function replaceRates(db: MarketDb, rows: RateRow[]): Promise<{ days: number; rows: number }> {
  const days = [...new Set(rows.map((r) => r.day))];
  await db.transaction(async (tx) => {
    for (let i = 0; i < days.length; i += CHUNK) {
      await tx.delete(exchangeRate).where(inArray(exchangeRate.day, days.slice(i, i + CHUNK)));
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(exchangeRate).values(rows.slice(i, i + CHUNK));
    }
  });
  return { days: days.length, rows: rows.length };
}

/**
 * Each currency's latest rate on or before `day`: the rule every conversion uses, so a weekend or
 * an ECB holiday falls back to the prior publish day. A currency not yet published by then is absent.
 */
export async function ratesOn(db: MarketDb, day: string): Promise<PerEur> {
  const rows = await db
    .selectDistinctOn([exchangeRate.currency], { currency: exchangeRate.currency, perEur: exchangeRate.perEur })
    .from(exchangeRate)
    .where(lte(exchangeRate.day, day))
    .orderBy(exchangeRate.currency, desc(exchangeRate.day));
  return new Map(rows.map((r) => [r.currency, r.perEur]));
}
