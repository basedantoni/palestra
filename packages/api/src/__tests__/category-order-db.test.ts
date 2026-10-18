/**
 * Category color and order against a real Postgres (PGlite, KOI-336).
 *
 * - the KOI-336 migration backfill gives seeded categories the seed order,
 *   colors and icons (the same as a new user's seed), and custom ones the
 *   places after them, by name, in palette order, with no icon
 * - `categories.list` returns the manual order after a reorder
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { MIGRATIONS_DIR } from "@life-tracker/db/migrations-dir";
import { category, user } from "@life-tracker/db/schema/index";
import { asc, eq, sql } from "drizzle-orm";

import { SEED_CATEGORIES, seedCategoryColor, seedCategoryIcon } from "../lib/category-seed";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const USER = "user-pglite-category-order";
const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);

/** The migration's last statement, the backfill. It recomputes every row, so it can be re-run here. */
const backfill = readFileSync(join(MIGRATIONS_DIR, readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith("0040_"))!), "utf8")
  .split("--> statement-breakpoint")
  .at(-1)!;

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(user).values({ id: USER, name: USER, email: `${USER}@test.internal` });
});

const ordered = () =>
  db
    .select({ name: category.name, color: category.color, icon: category.icon, sortOrder: category.sortOrder })
    .from(category)
    .where(eq(category.userId, USER))
    .orderBy(asc(category.sortOrder));

describe("KOI-336 backfill", () => {
  it("orders and colors seeded categories as the seed does, then custom ones by name", async () => {
    // Inserted out of order, as pre-KOI-336 rows, all at sortOrder 0 with no color.
    await db.insert(category).values([
      ...SEED_CATEGORIES.toReversed().map((name) => ({ id: randomUUID(), userId: USER, name, isSystem: true })),
      { id: randomUUID(), userId: USER, name: "Golf", isSystem: false },
      { id: randomUUID(), userId: USER, name: "Climbing", isSystem: false },
    ]);

    await db.execute(sql.raw(backfill));

    expect(await ordered()).toEqual([
      ...SEED_CATEGORIES.map((name, sortOrder) => ({
        name,
        color: seedCategoryColor(name),
        icon: seedCategoryIcon(name),
        sortOrder,
      })),
      { name: "Climbing", color: "blue", icon: null, sortOrder: SEED_CATEGORIES.length },
      { name: "Golf", color: "orange", icon: null, sortOrder: SEED_CATEGORIES.length + 1 },
    ]);
  });

  it("treats a custom category named like a seed as custom", async () => {
    await db.insert(category).values({ id: randomUUID(), userId: USER, name: "Travel", isSystem: false });

    await db.execute(sql.raw(backfill));

    expect(await ordered()).toEqual([{ name: "Travel", color: "blue", icon: null, sortOrder: 0 }]);
  });
});

describe("categories.reorder", () => {
  it("lists categories in the new order", async () => {
    const caller = makeCaller();
    const a = await caller.categories.create({ name: "A" });
    const b = await caller.categories.create({ name: "B" });
    const c = await caller.categories.create({ name: "C" });

    await caller.categories.reorder({ ids: [c.id, a.id, b.id] });

    expect((await caller.categories.list()).map((r) => r.name)).toEqual(["C", "A", "B"]);
  });
});
