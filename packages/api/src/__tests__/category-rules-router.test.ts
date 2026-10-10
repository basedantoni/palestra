/**
 * Category Rules CRUD + rule-aware Plaid sync (KOI-298).
 *
 * Mocked db: each db.select() call consumes the next queued result; writes are
 * recorded so tests can assert on table, values and rendered WHERE params.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, makeChain, mockPlaid } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = [], calls?: Array<[string, unknown[]]>) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch") return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally") return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return (...args: unknown[]) => {
            calls?.push([prop, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  };

  return { mockDb, makeChain, mockPlaid: { transactionsSync: vi.fn() } };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { categoryRule, transaction } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";

const USER_ID = "user-rules";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const RULE_ID = "00000000-0000-4000-8000-0000000000b1";
const CAT_ID = "00000000-0000-4000-8000-0000000000c1";

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL);

type Calls = Array<[string, unknown[]]>;
let insertCalls: Array<{ table: unknown; calls: Calls; returning: unknown[] }>;
let deleteCalls: Array<{ table: unknown; calls: Calls }>;
let updateCalls: Array<{ table: unknown; calls: Calls }>;
let updateError: unknown;
let ruleUpdateReturns: unknown[];
let insertReturns: unknown[];
let deleteReturns: unknown[];

/** Next db.select() resolves to these rows and records its WHERE clause. */
function selectReturns(rows: unknown[]): { params: () => unknown[] } {
  const calls: Calls = [];
  mockDb.select.mockReturnValueOnce(makeChain(rows, calls));
  return {
    params: () => {
      const where = calls.find(([m]) => m === "where")?.[1][0];
      return where ? render(where).params : [];
    },
  };
}

const callArg = (calls: Calls, method: string) => calls.find(([m]) => m === method)?.[1][0];

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  deleteCalls = [];
  updateCalls = [];
  updateError = undefined;
  ruleUpdateReturns = [{ id: RULE_ID }];
  insertReturns = [{ id: RULE_ID, pattern: "Starbucks", categoryId: CAT_ID }];
  deleteReturns = [{ id: RULE_ID }];
  mockDb.insert.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    insertCalls.push({ table, calls, returning: insertReturns });
    return makeChain(table === categoryRule ? insertReturns : [], calls);
  });
  mockDb.update.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    updateCalls.push({ table, calls });
    if (updateError && table === categoryRule) {
      const err = updateError;
      return { set: () => ({ where: () => ({ returning: () => Promise.reject(err) }) }) };
    }
    // Rule updates return the saved id; transaction updates report one row written each.
    return makeChain(table === categoryRule ? ruleUpdateReturns : { rowCount: 1 }, calls);
  });
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb));
  mockDb.delete.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    deleteCalls.push({ table, calls });
    return makeChain(table === categoryRule ? deleteReturns : [], calls);
  });
});

describe("categoryRules.list", () => {
  it("returns the caller's rules with their category", async () => {
    const rows = [
      { id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID, categoryName: "Coffee", createdAt: new Date() },
    ];
    const q = selectReturns(rows);

    await expect(makeCaller().categoryRules.list()).resolves.toEqual(rows);
    expect(q.params()).toEqual([USER_ID]);
  });
});

describe("categoryRules.create", () => {
  it("inserts a trimmed pattern for an owned category", async () => {
    const owned = selectReturns([{ id: CAT_ID }]);
    const existing = selectReturns([{ id: "r-other", pattern: "uber" }]);

    const result = await makeCaller().categoryRules.create({ pattern: "  Starbucks ", categoryId: CAT_ID });

    expect(result).toEqual({ rule: { id: RULE_ID, pattern: "Starbucks", categoryId: CAT_ID }, applied: 0 });
    expect(owned.params()).toEqual([CAT_ID, USER_ID]);
    expect(existing.params()).toEqual([USER_ID]);
    const insert = insertCalls.find((i) => i.table === categoryRule)!;
    expect(callArg(insert.calls, "values")).toMatchObject({
      userId: USER_ID,
      pattern: "Starbucks",
      categoryId: CAT_ID,
    });
  });

  it("rejects a foreign or missing category with NOT_FOUND", async () => {
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insertCalls).toEqual([]);
  });

  it("rejects a too-short pattern with BAD_REQUEST and a reason", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.create({ pattern: " ab ", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/at least 3/) });
    expect(insertCalls).toEqual([]);
  });

  it("rejects a case-insensitive duplicate with BAD_REQUEST", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([{ id: "r-existing", pattern: "Starbucks" }]);

    await expect(
      makeCaller().categoryRules.create({ pattern: "STARBUCKS", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already exists/) });
    expect(insertCalls).toEqual([]);
  });

  it("maps a lost insert race on the unique index to BAD_REQUEST", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);
    insertReturns = [];

    await expect(
      makeCaller().categoryRules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/** `set` + rendered WHERE params of each update against the transaction table. */
function transactionUpdates() {
  return updateCalls
    .filter((u) => u.table === transaction)
    .map(({ calls }) => ({ set: callArg(calls, "set"), params: render(callArg(calls, "where")).params }));
}

const OTHER_CAT = "00000000-0000-4000-8000-0000000000c2";
const existingRule = (id: string, pattern: string, categoryId: string, createdAt = "2026-01-01") => ({
  id,
  pattern,
  categoryId,
  createdAt: new Date(createdAt),
});
const txn = (id: string, name: string, categoryId: string | null) => ({
  id,
  name,
  plaidCategoryPrimary: "FOOD_AND_DRINK",
  categoryId,
});
/** The selects plannedChanges runs after the rules: categories, then non-manual transactions. */
function applyContext(rows: unknown[]): { txnParams: () => unknown[] } {
  selectReturns([{ id: "cat-food", name: "Food & Drink" }]);
  const t = selectReturns(rows);
  return { txnParams: t.params };
}

describe("categoryRules.preview", () => {
  it("counts non-manual transactions whose category would change", async () => {
    const owned = selectReturns([{ id: CAT_ID }]);
    selectReturns([]); // rules
    const ctx = applyContext([
      txn("t1", "STARBUCKS #1", "cat-food"), // would change
      txn("t2", "STARBUCKS #2", CAT_ID), // already there
      txn("t3", "CHIPOTLE", "cat-food"), // no match
    ]);

    await expect(
      makeCaller().categoryRules.preview({ pattern: "starbucks", categoryId: CAT_ID }),
    ).resolves.toEqual({ matchCount: 1 });
    expect(owned.params()).toEqual([CAT_ID, USER_ID]);
    // Scoped to the caller; hand-picked categories excluded (blank manual rows allowed).
    expect(ctx.txnParams()).toEqual([USER_ID, false]);
  });

  it("previews an edit as replacing the existing rule", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    applyContext([txn("t1", "STARBUCKS #1", OTHER_CAT), txn("t2", "STARBUCKS RESERVE", OTHER_CAT)]);

    await expect(
      makeCaller().categoryRules.preview({ pattern: "starbucks reserve", categoryId: CAT_ID, ruleId: RULE_ID }),
    ).resolves.toEqual({ matchCount: 2 }); // t2 → CAT_ID, t1 loses the rule → Default Category
  });

  it("respects longer patterns from other rules", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule("r-long", "amazon prime", OTHER_CAT)]);
    applyContext([txn("t1", "AMAZON PRIME*1", OTHER_CAT), txn("t2", "AMAZON MKTP", "cat-food")]);

    await expect(makeCaller().categoryRules.preview({ pattern: "amazon", categoryId: CAT_ID })).resolves.toEqual({
      matchCount: 1,
    });
  });

  it("is zero for a pattern too short to save, without querying", async () => {
    await expect(makeCaller().categoryRules.preview({ pattern: "ab", categoryId: CAT_ID })).resolves.toEqual({
      matchCount: 0,
    });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.preview({ pattern: "starbucks", categoryId: CAT_ID, ruleId: RULE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("categoryRules.create with applyToExisting", () => {
  it("leaves rows the new pattern doesn't match alone", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]); // rules
    // UBER TRIP still carries a deleted rule's category; applying "starbucks" must not revert it.
    applyContext([txn("t1", "UBER TRIP", OTHER_CAT)]);

    const result = await makeCaller().categoryRules.create({
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(0);
    expect(transactionUpdates()).toEqual([]);
  });

  it("updates exactly the changing non-manual rows, scoped to the caller", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]); // rules
    applyContext([txn("t1", "STARBUCKS #1", "cat-food"), txn("t2", "STARBUCKS #2", CAT_ID), txn("t3", "CHIPOTLE", "cat-food")]);

    const result = await makeCaller().categoryRules.create({
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([{ set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] }]);
  });

  it("fills a blank Manual Category the rule matches", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]); // rules
    applyContext([
      { ...txn("t1", "KFC #1", null), categoryOverridden: true },
      { ...txn("t2", "KFC #2", OTHER_CAT), categoryOverridden: true }, // hand-picked: never loaded, but guard anyway
    ]);
    insertReturns = [{ id: RULE_ID, pattern: "kfc", categoryId: CAT_ID }];

    const result = await makeCaller().categoryRules.create({ pattern: "kfc", categoryId: CAT_ID, applyToExisting: true });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([
      { set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] },
    ]);
  });

  it("updates nothing without applyToExisting", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);

    const result = await makeCaller().categoryRules.create({ pattern: "starbucks", categoryId: CAT_ID });

    expect(result.applied).toBe(0);
    expect(transactionUpdates()).toEqual([]);
  });
});

describe("categoryRules.update", () => {
  it("saves the edited rule, scoped to the caller, and leaves transactions alone without apply", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);

    const result = await makeCaller().categoryRules.update({ id: RULE_ID, pattern: " Starbucks ", categoryId: CAT_ID });

    expect(result).toEqual({ rule: { id: RULE_ID, pattern: "Starbucks", categoryId: CAT_ID }, applied: 0 });
    const ruleUpdate = updateCalls.find((u) => u.table === categoryRule)!;
    expect(callArg(ruleUpdate.calls, "set")).toEqual({ pattern: "Starbucks", categoryId: CAT_ID });
    expect(render(callArg(ruleUpdate.calls, "where")).params).toEqual([RULE_ID, USER_ID]);
    expect(transactionUpdates()).toEqual([]);
  });

  it("re-resolves past transactions against the edited rule set when applying", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    applyContext([txn("t1", "STARBUCKS #1", OTHER_CAT), txn("t2", "CHIPOTLE", "cat-food")]);

    const result = await makeCaller().categoryRules.update({
      id: RULE_ID,
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([{ set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] }]);
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]); // the caller has no such rule

    await expect(
      makeCaller().categoryRules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateCalls).toEqual([]);
  });

  it("rejects a rule deleted mid-save with NOT_FOUND and applies nothing", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    ruleUpdateReturns = [];

    await expect(
      makeCaller().categoryRules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID, applyToExisting: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(transactionUpdates()).toEqual([]);
  });

  it("rejects a foreign category with NOT_FOUND", async () => {
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateCalls).toEqual([]);
  });

  it("allows keeping its own pattern but rejects another rule's", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT), existingRule("r2", "uber", OTHER_CAT)]);

    await expect(
      makeCaller().categoryRules.update({ id: RULE_ID, pattern: "UBER", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already exists/) });
    expect(updateCalls).toEqual([]);
  });

  it("maps a unique-index race to BAD_REQUEST", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    updateError = Object.assign(new Error("Failed query"), { cause: { code: "23505" } });

    await expect(
      makeCaller().categoryRules.update({ id: RULE_ID, pattern: "uber", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("categoryRules.delete", () => {
  it("deletes only the caller's rule and leaves transactions untouched", async () => {
    await makeCaller().categoryRules.delete({ id: RULE_ID });

    expect(deleteCalls.map((d) => d.table)).toEqual([categoryRule]);
    expect(render(callArg(deleteCalls[0]!.calls, "where")).params).toEqual([RULE_ID, USER_ID]);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    deleteReturns = [];

    await expect(makeCaller().categoryRules.delete({ id: RULE_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

function syncWith(names: string[], rules: unknown[]) {
  selectReturns([
    { id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: null, plaidEnv: env.PLAID_ENV },
  ]);
  mockPlaid.transactionsSync.mockResolvedValueOnce({
    data: {
      added: names.map((name, i) => ({
        transaction_id: `plaid-txn-${i}`,
        account_id: "p_chk",
        amount: 12,
        date: "2026-09-30",
        name,
        pending: false,
        personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: null },
      })),
      modified: [],
      removed: [],
      accounts: [],
      next_cursor: "c2",
      has_more: false,
    },
  });
  selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]); // accounts
  selectReturns([{ id: "cat-food", name: "Food & Drink" }]); // categories
  const rulesQuery = selectReturns(rules); // rules
  selectReturns([]); // transfer candidates
  return rulesQuery;
}

const insertedCategoryIds = () =>
  insertCalls
    .filter((i) => i.table === transaction)
    .map((i) => (callArg(i.calls, "values") as { categoryId: string | null }).categoryId);

describe("syncPlaidItem with Category Rules", () => {
  it("loads the user's rules once and categorizes new transactions by them", async () => {
    const rulesQuery = syncWith(
      ["SQ *STARBUCKS #12", "CHIPOTLE 42"],
      [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }],
    );

    await syncPlaidItem(ITEM_ID);

    expect(rulesQuery.params()).toEqual([USER_ID]);
    expect(insertedCategoryIds()).toEqual(["cat-coffee", "cat-food"]);
    expect(mockDb.select).toHaveBeenCalledTimes(5);
  });

  it("still leaves categoryId alone on conflict", async () => {
    syncWith(["STARBUCKS"], [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }]);

    await syncPlaidItem(ITEM_ID);

    const upsert = insertCalls.find((i) => i.table === transaction)!;
    const onConflict = callArg(upsert.calls, "onConflictDoUpdate") as { set: Record<string, unknown> };
    expect(onConflict.set).not.toHaveProperty("categoryId");
  });
});
