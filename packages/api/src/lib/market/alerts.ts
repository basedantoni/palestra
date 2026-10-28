/**
 * The admin notifications Market Watch sends (KOI-365): a day a capture missed, and a database
 * nearing its volume.
 */
import { sql } from "drizzle-orm";

import { notifyAdmins } from "../admins";
import type { MarketSource } from "./capture";
import type { MarketDb } from "./exchange-rate-db";

const GB = 1024 ** 3;
const VOLUME = 5 * GB;

/** `palestra-db`'s volume is 5 GB; admins hear about it at 80%. */
export const DATABASE_SIZE_LIMIT = 0.8 * VOLUME;

const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

/** A capture whose last retry failed: that source has no prices for that day. */
export const captureFailed = (source: MarketSource, day: string, err: unknown) => ({
  type: "market_capture_failed" as const,
  title: "Market capture failed",
  message: `The ${source} capture for ${day} failed its last retry: ${err instanceof Error ? err.message : String(err)}`,
  payload: { source, day },
});

/** The database's size on disk, in bytes. */
export async function databaseSize(db: MarketDb): Promise<number> {
  const { rows } = (await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`)) as unknown as {
    rows: Array<{ bytes: string | number }>;
  };
  return Number(rows[0]!.bytes);
}

/** Notify every admin when the database is past the limit (`market.ecb` checks once a day). */
export async function guardDatabaseSize(deps: {
  db: MarketDb;
  adminEmails: string[];
  databaseSize: () => Promise<number>;
}) {
  const bytes = await deps.databaseSize();
  if (bytes <= DATABASE_SIZE_LIMIT) return;
  await notifyAdmins(deps.db, deps.adminEmails, {
    type: "database_near_full",
    title: "Database nearly full",
    message: `The database is ${gb(bytes)}, past ${gb(DATABASE_SIZE_LIMIT)} (80% of its ${gb(VOLUME)} volume). Extend the palestra-db volume.`,
    payload: { bytes, limit: DATABASE_SIZE_LIMIT },
  });
}
