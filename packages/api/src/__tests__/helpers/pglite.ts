/**
 * In-process Postgres for DB-backed API tests (KOI-296): PGlite, no Docker.
 *
 * Each test file that wires it in gets its own fresh database with every
 * migration in packages/db applied, so queries run against real constraints,
 * indexes and SQL instead of a mock:
 *
 *   vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));
 *   import { db } from "@life-tracker/db";
 *
 * Call `truncateAll(db)` in `beforeEach` to isolate tests within the file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@life-tracker/db/schema/index";

type TestDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("../../../../db/src/migrations", import.meta.url));

/**
 * Apply every migration in journal order. Not drizzle's pglite migrator: that
 * sends each chunk as a prepared statement, and some applied migrations hold
 * several statements without a breakpoint (fine on node-postgres, which the
 * real deploy uses). `exec` runs them through the simple query protocol.
 */
async function applyMigrations(client: PGlite): Promise<void> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  for (const { tag } of journal.entries) {
    await client.exec(readFileSync(join(MIGRATIONS, `${tag}.sql`), "utf8"));
  }
}

/** A fresh, migrated database, shaped like the `@life-tracker/db` module. */
export async function pgliteDbModule() {
  const client = new PGlite();
  await applyMigrations(client);
  return { db: drizzle(client, { schema }) };
}

/** Empty every app table, keeping the schema. */
export async function truncateAll(db: TestDb): Promise<void> {
  const { rows } = (await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )) as unknown as { rows: Array<{ tablename: string }> };
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}

/**
 * A user with one linked bank account, a custom category, and one transaction
 * in that category: the rows most finance tests hang off.
 */
export async function seedFinanceUser(db: TestDb, userId: string) {
  const plaidItemId = randomUUID();
  const accountId = randomUUID();
  const categoryId = randomUUID();
  const transactionId = randomUUID();

  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@test.internal` });
  await db.insert(schema.plaidItem).values({
    id: plaidItemId,
    userId,
    itemId: `item-${userId}`,
    accessTokenEnc: "not-a-real-token",
    plaidEnv: "sandbox",
  });
  await db.insert(schema.financialAccount).values({
    id: accountId,
    userId,
    plaidItemId,
    plaidAccountId: `acct-${userId}`,
    name: "Checking",
    type: "depository",
  });
  await db.insert(schema.category).values({ id: categoryId, userId, name: "Climbing" });
  await db.insert(schema.transaction).values({
    id: transactionId,
    userId,
    accountId,
    plaidTransactionId: `txn-${userId}`,
    amount: 42,
    date: new Date("2026-09-15T00:00:00.000Z"),
    name: "MOVEMENT CLIMBING GYM",
    flow: "expense",
    categoryId,
  });

  return { plaidItemId, accountId, categoryId, transactionId };
}
