/**
 * Bank Category mapping router (KOI-335): list every PFC primary with its
 * mapped category, and remap one, re-resolving the caller's automatic rows of
 * that Bank Category. Mocked db (helpers/mock-db).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { bankCategoryMapping, category, categoryRule, transaction } from "@life-tracker/db/schema/index";

import { PFC_PRIMARIES } from "../lib/category-seed";
import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-bank-categories";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const DINING = "00000000-0000-4000-8000-0000000000c2";
const COFFEE = "00000000-0000-4000-8000-0000000000c3";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

/** The caller is already seeded: FOOD_AND_DRINK → Food, BANK_FEES unmapped. */
const seededMapping = () =>
  mockDb.onSelect(bankCategoryMapping, [
    { pfcPrimary: "FOOD_AND_DRINK", categoryId: FOOD },
    { pfcPrimary: "BANK_FEES", categoryId: null },
  ]);

const txn = (id: string, name: string, categoryId: string | null) => ({
  id,
  name,
  plaidCategoryPrimary: "FOOD_AND_DRINK",
  categoryId,
  categoryOverridden: false,
});

const transactionUpdates = () => mockDb.updated(transaction);

beforeEach(() => {
  mockDb.fallback("update", transaction, { rowCount: 1 });
});

describe("bankCategories.list", () => {
  it("returns every PFC primary with its mapped category, null when unmapped", async () => {
    seededMapping();

    const list = await makeCaller().bankCategories.list();

    expect(list.map((b) => b.pfcPrimary)).toEqual([...PFC_PRIMARIES]);
    expect(list.find((b) => b.pfcPrimary === "FOOD_AND_DRINK")!.categoryId).toBe(FOOD);
    expect(list.find((b) => b.pfcPrimary === "BANK_FEES")!.categoryId).toBeNull();
    expect(list.find((b) => b.pfcPrimary === "TRAVEL")!.categoryId).toBeNull();
    expect(mockDb.selected(bankCategoryMapping)).toEqual([[USER_ID]]);
  });
});

describe("bankCategories.setMapping", () => {
  it("stores the mapping for the caller", async () => {
    mockDb.onSelect(category, [{ id: DINING }]);
    seededMapping();

    await makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING });

    expect(mockDb.selected(category)).toEqual([[DINING, USER_ID]]);
    expect(mockDb.inserted(bankCategoryMapping)).toEqual([
      { userId: USER_ID, pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING },
    ]);
  });

  it("re-resolves only the caller's automatic rows of that Bank Category", async () => {
    mockDb.onSelect(category, [{ id: DINING }]);
    seededMapping();
    mockDb.onSelect(transaction, [txn("t1", "CHIPOTLE", FOOD), txn("t2", "SWEETGREEN", DINING)]);

    const result = await makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING });

    // Scope: the caller, this PFC primary, automatic rows only.
    expect(mockDb.selected(transaction)).toEqual([[USER_ID, "FOOD_AND_DRINK", false]]);
    expect(transactionUpdates()).toEqual([
      { set: { categoryId: DINING, categoryOverridden: false }, where: [USER_ID, false, "t1"] },
    ]);
    expect(result).toEqual({ applied: 1 });
  });

  it("lets a matching rule win over the new mapping", async () => {
    mockDb.onSelect(category, [{ id: DINING }]);
    seededMapping();
    mockDb.onSelect(categoryRule, [{ id: "r1", pattern: "starbucks", categoryId: COFFEE, createdAt: new Date() }]);
    mockDb.onSelect(transaction, [txn("t1", "STARBUCKS #1", COFFEE), txn("t2", "CHIPOTLE", FOOD)]);

    await makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING });

    expect(transactionUpdates().map((u) => u.where.at(-1))).toEqual(["t2"]);
  });

  it("unmaps to Uncategorized without a category check", async () => {
    seededMapping();
    mockDb.onSelect(transaction, [txn("t1", "CHIPOTLE", FOOD)]);

    await makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: null });

    expect(mockDb.selected(category)).toEqual([]);
    expect(mockDb.inserted(bankCategoryMapping)).toEqual([
      { userId: USER_ID, pfcPrimary: "FOOD_AND_DRINK", categoryId: null },
    ]);
    expect(transactionUpdates().map((u) => u.set)).toEqual([{ categoryId: null, categoryOverridden: false }]);
  });

  it("rejects a category the caller doesn't own, writing nothing", async () => {
    // Nothing queued for category: the ownership lookup finds none.
    await expect(
      makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.inserted(bankCategoryMapping)).toEqual([]);
    expect(transactionUpdates()).toEqual([]);
  });

  it("rejects an unknown PFC primary", async () => {
    await expect(
      makeCaller().bankCategories.setMapping({ pfcPrimary: "NOT_A_PFC" as never, categoryId: null }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("seeds a user who was never seeded before storing their choice", async () => {
    // No mapping rows yet: the seed writes categories and the full mapping first.
    mockDb.onSelect(category, [{ id: DINING }], [{ id: FOOD, name: "Food & Drink" }]);

    await makeCaller().bankCategories.setMapping({ pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING });

    expect(mockDb.inserted(category).length).toBeGreaterThan(0);
    const mappings = mockDb.inserted(bankCategoryMapping) as Array<{ pfcPrimary: string; categoryId: string | null }>;
    expect(mappings).toHaveLength(PFC_PRIMARIES.length + 1);
    expect(mappings.at(-1)).toEqual({ userId: USER_ID, pfcPrimary: "FOOD_AND_DRINK", categoryId: DINING });
  });
});
