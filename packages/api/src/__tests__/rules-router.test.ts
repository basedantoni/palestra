/**
 * Rules CRUD + rule-aware Plaid sync (KOI-298, KOI-339, KOI-340).
 *
 * Mocked db (helpers/mock-db): selects are answered per table, and writes are
 * recorded so tests can assert on table, values and rendered WHERE params.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPlaid } = vi.hoisted(() => ({
  mockPlaid: { transactionsSync: vi.fn(), accountsGet: vi.fn(async () => ({ data: { accounts: [] } })) },
}));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import {
  bankCategoryMapping,
  category,
  rule,
  financialAccount,
  plaidItem,
  transaction,
} from "@life-tracker/db/schema/index";

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";
import { mockDb, rejectWith } from "./helpers/mock-db";

const USER_ID = "user-rules";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const RULE_ID = "00000000-0000-4000-8000-0000000000b1";
const CAT_ID = "00000000-0000-4000-8000-0000000000c1";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

/** The category ownership check finds the category (or, with [], doesn't). */
const ownsCategory = (rows: unknown[] = [{ id: CAT_ID }]) => mockDb.onSelect(category, rows);
/** The caller's existing Rules. */
const rulesAre = (rows: unknown[]) => mockDb.onSelect(rule, rows);
/** Every update, whatever the table. */
const updates = () => mockDb.opsOf("update");

beforeEach(() => {
  vi.clearAllMocks();
  // Rule writes return the saved row; transaction updates report one row written each.
  mockDb.fallback("insert", rule, [{ id: RULE_ID, pattern: "Starbucks", matchMode: "contains", categoryId: CAT_ID }]);
  mockDb.fallback("update", rule, [{ id: RULE_ID }]);
  mockDb.fallback("delete", rule, [{ id: RULE_ID }]);
  mockDb.fallback("update", transaction, { rowCount: 1 });
});

describe("rules.list", () => {
  it("returns the caller's rules with their category", async () => {
    const rows = [
      { id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID, categoryName: "Coffee", createdAt: new Date() },
    ];
    rulesAre(rows);

    await expect(makeCaller().rules.list()).resolves.toEqual(rows);
    expect(mockDb.selected(rule)).toEqual([[USER_ID]]);
  });
});

describe("rules.create", () => {
  it("inserts a trimmed pattern for an owned category", async () => {
    ownsCategory();
    rulesAre([{ id: "r-other", pattern: "uber", matchMode: "contains" }]);

    const result = await makeCaller().rules.create({ pattern: "  Starbucks ", categoryId: CAT_ID });

    expect(result).toEqual({
      rule: { id: RULE_ID, pattern: "Starbucks", matchMode: "contains", categoryId: CAT_ID },
      applied: 0,
    });
    expect(mockDb.selected(category)).toEqual([[CAT_ID, USER_ID]]);
    expect(mockDb.selected(rule)).toEqual([[USER_ID]]);
    expect(mockDb.inserted(rule)[0]).toMatchObject({
      userId: USER_ID,
      pattern: "Starbucks",
      patternKey: "starbucks",
      matchMode: "contains",
      categoryId: CAT_ID,
    });
  });

  it("rejects a foreign or missing category with NOT_FOUND", async () => {
    ownsCategory([]);

    await expect(
      makeCaller().rules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.inserted(rule)).toEqual([]);
  });

  it("rejects a too-short pattern with BAD_REQUEST and a reason", async () => {
    ownsCategory();
    rulesAre([]);

    await expect(
      makeCaller().rules.create({ pattern: " ab ", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/at least 3/) });
    expect(mockDb.inserted(rule)).toEqual([]);
  });

  it("rejects a case-insensitive duplicate with BAD_REQUEST", async () => {
    ownsCategory();
    rulesAre([{ id: "r-existing", pattern: "Starbucks", matchMode: "contains" }]);

    await expect(
      makeCaller().rules.create({ pattern: "STARBUCKS", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already exists/) });
    expect(mockDb.inserted(rule)).toEqual([]);
  });

  it("maps a lost insert race on the unique index to BAD_REQUEST", async () => {
    ownsCategory();
    mockDb.onInsert(rule, []); // lost the race: nothing inserted

    await expect(
      makeCaller().rules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/** `set` + rendered WHERE params of each update against the transaction table. */
const transactionUpdates = () => mockDb.updated(transaction).map((u) => ({ set: u.set, params: u.where }));

const OTHER_CAT = "00000000-0000-4000-8000-0000000000c2";
const existingRule = (
  id: string,
  pattern: string,
  categoryId: string | null,
  createdAt = "2026-01-01",
  setFlow: string | null = null,
) => ({
  id,
  pattern,
  matchMode: "contains" as const,
  categoryId,
  setFlow,
  createdAt: new Date(createdAt),
});
const txn = (id: string, name: string, categoryId: string | null) => ({
  id,
  name,
  plaidCategoryPrimary: "FOOD_AND_DRINK",
  categoryId,
  flow: "expense",
  flowOverridden: false,
  transferPairId: null as string | null,
});
/** A bank-classified incoming transfer with no category, as a Zelle payment arrives. */
const transferIn = (id: string, name: string) => ({ ...txn(id, name, null), plaidCategoryPrimary: "TRANSFER_IN", flow: "transfer" });
/** The SQL text of a drizzle fragment, such as an update's WHERE. */
const sqlText = (fragment: unknown) => new PgDialect().sqlToQuery(fragment as SQL).sql;
/** The caller's Bank Category mapping: FOOD_AND_DRINK → cat-food. */
const mappedFood = () => mockDb.onSelect(bankCategoryMapping, [{ pfcPrimary: "FOOD_AND_DRINK", categoryId: "cat-food" }]);

/** The selects plannedChanges runs after the rules: the mapping, then non-manual transactions. */
function applyContext(rows: unknown[]) {
  mappedFood();
  mockDb.onSelect(transaction, rows);
}

describe("rules.preview", () => {
  it("counts non-manual transactions whose category would change", async () => {
    ownsCategory();
    rulesAre([]);
    applyContext([
      txn("t1", "STARBUCKS #1", "cat-food"), // would change
      txn("t2", "STARBUCKS #2", CAT_ID), // already there
      txn("t3", "CHIPOTLE", "cat-food"), // no match
    ]);

    await expect(
      makeCaller().rules.preview({ pattern: "starbucks", categoryId: CAT_ID }),
    ).resolves.toEqual({ matchCount: 1 });
    expect(mockDb.selected(category)[0]).toEqual([CAT_ID, USER_ID]);
    // Scoped to the caller; rows neither a category nor a flow rule may change are excluded.
    expect(mockDb.selected(transaction)).toEqual([[USER_ID, false, false]]);
  });

  it("previews an edit as replacing the existing rule", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    applyContext([txn("t1", "STARBUCKS #1", OTHER_CAT), txn("t2", "STARBUCKS RESERVE", OTHER_CAT)]);

    await expect(
      makeCaller().rules.preview({ pattern: "starbucks reserve", categoryId: CAT_ID, ruleId: RULE_ID }),
    ).resolves.toEqual({ matchCount: 2 }); // t2 → CAT_ID, t1 loses the rule → Default Category
  });

  it("respects longer patterns from other rules", async () => {
    ownsCategory();
    rulesAre([existingRule("r-long", "amazon prime", OTHER_CAT)]);
    applyContext([txn("t1", "AMAZON PRIME*1", OTHER_CAT), txn("t2", "AMAZON MKTP", "cat-food")]);

    await expect(makeCaller().rules.preview({ pattern: "amazon", categoryId: CAT_ID })).resolves.toEqual({
      matchCount: 1,
    });
  });

  it("counts only whole-description matches for an exact rule", async () => {
    ownsCategory();
    rulesAre([]);
    applyContext([txn("t1", "STARBUCKS", "cat-food"), txn("t2", "STARBUCKS #2", "cat-food")]);

    await expect(
      makeCaller().rules.preview({ pattern: "starbucks", matchMode: "exact", categoryId: CAT_ID }),
    ).resolves.toEqual({ matchCount: 1 });
  });

  it("is zero for a pattern too short to save, without querying", async () => {
    await expect(makeCaller().rules.preview({ pattern: "ab", categoryId: CAT_ID })).resolves.toEqual({
      matchCount: 0,
    });
    expect(mockDb.db.select).not.toHaveBeenCalled();
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    ownsCategory();
    rulesAre([]);

    await expect(
      makeCaller().rules.preview({ pattern: "starbucks", categoryId: CAT_ID, ruleId: RULE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rules.create with applyToExisting", () => {
  it("leaves rows the new pattern doesn't match alone", async () => {
    ownsCategory();
    rulesAre([]);
    // UBER TRIP still carries a deleted rule's category; applying "starbucks" must not revert it.
    applyContext([txn("t1", "UBER TRIP", OTHER_CAT)]);

    const result = await makeCaller().rules.create({
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(0);
    expect(transactionUpdates()).toEqual([]);
  });

  it("updates exactly the changing non-manual rows, scoped to the caller", async () => {
    ownsCategory();
    rulesAre([]);
    applyContext([txn("t1", "STARBUCKS #1", "cat-food"), txn("t2", "STARBUCKS #2", CAT_ID), txn("t3", "CHIPOTLE", "cat-food")]);

    const result = await makeCaller().rules.create({
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([{ set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] }]);
  });

  it("fills a blank Manual Category the rule matches", async () => {
    ownsCategory();
    rulesAre([]);
    applyContext([
      { ...txn("t1", "KFC #1", null), categoryOverridden: true },
      { ...txn("t2", "KFC #2", OTHER_CAT), categoryOverridden: true }, // hand-picked: never loaded, but guard anyway
    ]);
    mockDb.onInsert(rule, [{ id: RULE_ID, pattern: "kfc", categoryId: CAT_ID }]);

    const result = await makeCaller().rules.create({ pattern: "kfc", categoryId: CAT_ID, applyToExisting: true });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([
      { set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] },
    ]);
  });

  it("updates nothing without applyToExisting", async () => {
    ownsCategory();
    rulesAre([]);

    const result = await makeCaller().rules.create({ pattern: "starbucks", categoryId: CAT_ID });

    expect(result.applied).toBe(0);
    expect(transactionUpdates()).toEqual([]);
  });
});

describe("flow rules", () => {
  it("saves a flow-only rule without a category check", async () => {
    rulesAre([]);
    mockDb.onInsert(rule, [{ id: RULE_ID, pattern: "zelle from jane", categoryId: null, setFlow: "income" }]);

    await makeCaller().rules.create({ pattern: "zelle from jane", setFlow: "income" });

    expect(mockDb.selected(category)).toEqual([]);
    expect(mockDb.inserted(rule)[0]).toMatchObject({ categoryId: null, setFlow: "income" });
  });

  it("rejects a rule that sets nothing, or a category on an income rule, with BAD_REQUEST", async () => {
    await expect(makeCaller().rules.create({ pattern: "zelle" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      makeCaller().rules.create({ pattern: "zelle", setFlow: "income", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Income and transfer rules set no category" });
    await expect(
      makeCaller().rules.preview({ pattern: "zelle", setFlow: "transfer", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.inserted(rule)).toEqual([]);
  });

  it("counts flow changes in the preview", async () => {
    rulesAre([]);
    applyContext([transferIn("t1", "ZELLE FROM JANE"), transferIn("t2", "ZELLE TO BOB")]);

    await expect(makeCaller().rules.preview({ pattern: "zelle from jane", setFlow: "income" })).resolves.toEqual({
      matchCount: 1,
    });
  });

  it("applies a flow rule's flow to matching unlocked rows, guarding the write", async () => {
    rulesAre([]);
    applyContext([transferIn("t1", "ZELLE FROM JANE"), transferIn("t2", "ZELLE TO BOB")]);
    mockDb.onInsert(rule, [{ id: RULE_ID, pattern: "zelle from jane", matchMode: "contains", categoryId: null, setFlow: "income", createdAt: new Date() }]);

    const result = await makeCaller().rules.create({ pattern: "zelle from jane", setFlow: "income", applyToExisting: true });

    expect(result.applied).toBe(1);
    // Off expense the category goes with the flow (KOI-341).
    expect(transactionUpdates()).toEqual([{ set: { categoryId: null, flow: "income" }, params: [USER_ID, false, "t1"] }]);
    // A flow hand-set or paired since the read is left alone; the category guard doesn't apply, even to a Manual Category.
    const where = sqlText(mockDb.opsOn(transaction, "update")[0]!.arg("where"));
    expect(where).toMatch(/"flow_overridden" = \$\d+ and "transaction"."transfer_pair_id" is null/);
    expect(where).not.toMatch(/category_overridden/);
  });

  it("never changes the flow of a Transfer Pair's leg", async () => {
    rulesAre([]);
    applyContext([{ ...transferIn("t1", "ZELLE FROM JANE"), transferPairId: "pair-1" }]);
    mockDb.onInsert(rule, [{ id: RULE_ID, pattern: "zelle from jane", matchMode: "contains", categoryId: null, setFlow: "income", createdAt: new Date() }]);

    const result = await makeCaller().rules.create({ pattern: "zelle from jane", setFlow: "income", applyToExisting: true });

    expect(result.applied).toBe(0);
    expect(transactionUpdates()).toEqual([]);
  });

  it("writes flow and category together, under both guards, when the rule sets both", async () => {
    ownsCategory();
    rulesAre([]);
    applyContext([transferIn("t1", "VENMO RENT")]);
    mockDb.onInsert(rule, [{ id: RULE_ID, pattern: "venmo rent", matchMode: "contains", categoryId: CAT_ID, setFlow: "expense", createdAt: new Date() }]);

    const result = await makeCaller().rules.create({ pattern: "venmo rent", setFlow: "expense", categoryId: CAT_ID, applyToExisting: true });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([
      { set: { categoryId: CAT_ID, categoryOverridden: false, flow: "expense" }, params: [USER_ID, false, false, "t1"] },
    ]);
  });

  it("saves an edited rule's flow", async () => {
    rulesAre([existingRule(RULE_ID, "zelle from jane", null, "2026-01-01", "income")]);

    await makeCaller().rules.update({ id: RULE_ID, pattern: "zelle from jane", setFlow: "transfer" });

    expect(mockDb.updated(rule)[0]!.set).toMatchObject({ categoryId: null, setFlow: "transfer" });
  });
});

describe("rules.update", () => {
  it("saves the edited rule, scoped to the caller, and leaves transactions alone without apply", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);

    const result = await makeCaller().rules.update({ id: RULE_ID, pattern: " Starbucks ", categoryId: CAT_ID });

    expect(result).toEqual({
      rule: { id: RULE_ID, pattern: "Starbucks", matchMode: "contains", categoryId: CAT_ID, setFlow: null },
      applied: 0,
    });
    expect(mockDb.updated(rule)).toEqual([
      {
        set: { pattern: "Starbucks", patternKey: "starbucks", matchMode: "contains", categoryId: CAT_ID, setFlow: null },
        where: [RULE_ID, USER_ID],
      },
    ]);
    expect(transactionUpdates()).toEqual([]);
  });

  it("re-resolves past transactions against the edited rule set when applying", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    applyContext([txn("t1", "STARBUCKS #1", OTHER_CAT), txn("t2", "CHIPOTLE", "cat-food")]);

    const result = await makeCaller().rules.update({
      id: RULE_ID,
      pattern: "starbucks",
      categoryId: CAT_ID,
      applyToExisting: true,
    });

    expect(result.applied).toBe(1);
    expect(transactionUpdates()).toEqual([{ set: { categoryId: CAT_ID, categoryOverridden: false }, params: [USER_ID, false, "t1"] }]);
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    ownsCategory();
    rulesAre([]); // the caller has no such rule

    await expect(
      makeCaller().rules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates()).toEqual([]);
  });

  it("rejects a rule deleted mid-save with NOT_FOUND and applies nothing", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    mockDb.onUpdate(rule, []); // deleted mid-save: nothing updated

    await expect(
      makeCaller().rules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID, applyToExisting: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(transactionUpdates()).toEqual([]);
  });

  it("rejects a foreign category with NOT_FOUND", async () => {
    ownsCategory([]);

    await expect(
      makeCaller().rules.update({ id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates()).toEqual([]);
  });

  it("allows keeping its own pattern but rejects another rule's", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT), existingRule("r2", "uber", OTHER_CAT)]);

    await expect(
      makeCaller().rules.update({ id: RULE_ID, pattern: "UBER", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already exists/) });
    expect(updates()).toEqual([]);
  });

  it("maps a unique-index race to BAD_REQUEST", async () => {
    ownsCategory();
    rulesAre([existingRule(RULE_ID, "starbucks", OTHER_CAT)]);
    mockDb.onUpdate(rule, rejectWith(Object.assign(new Error("Failed query"), { cause: { code: "23505" } })));

    await expect(
      makeCaller().rules.update({ id: RULE_ID, pattern: "uber", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("rules.delete", () => {
  it("deletes only the caller's rule and leaves transactions untouched", async () => {
    await makeCaller().rules.delete({ id: RULE_ID });

    expect(mockDb.opsOf("delete").map((op) => op.table)).toEqual([rule]);
    expect(mockDb.deleted(rule)).toEqual([[RULE_ID, USER_ID]]);
    expect(updates()).toEqual([]);
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    mockDb.onDelete(rule, []); // nothing deleted

    await expect(makeCaller().rules.delete({ id: RULE_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

/** One Plaid sync of `names` (all FOOD_AND_DRINK); `seeded` users already have a mapping. */
function syncWith(names: string[], rules: unknown[], seeded = true) {
  mockDb.onSelect(plaidItem, [
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
  mockDb.onSelect(financialAccount, [{ id: "fa-chk", plaidAccountId: "p_chk" }]);
  if (seeded) mappedFood();
  rulesAre(rules);
}

/** One Plaid sync of `added` transactions with a given primary each. */
function syncWithPrimaries(added: Array<[name: string, primary: string]>, rules: unknown[]) {
  syncWith([], rules);
  mockPlaid.transactionsSync.mockReset().mockResolvedValueOnce({
    data: {
      added: added.map(([name, primary], i) => ({
        transaction_id: `plaid-txn-${i}`,
        account_id: "p_chk",
        amount: -50,
        date: "2026-09-30",
        name,
        pending: false,
        personal_finance_category: { primary, detailed: null },
      })),
      modified: [],
      removed: [],
      accounts: [],
      next_cursor: "c2",
      has_more: false,
    },
  });
}

const insertedCategoryIds = () =>
  (mockDb.inserted(transaction) as Array<{ categoryId: string | null }>).map((v) => v.categoryId);

describe("syncPlaidItem with Rules", () => {
  it("loads the user's rules once and categorizes new transactions by them", async () => {
    syncWith(
      ["SQ *STARBUCKS #12", "CHIPOTLE 42"],
      [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }],
    );

    await syncPlaidItem(ITEM_ID);

    expect(mockDb.selected(rule)).toEqual([[USER_ID]]); // once, scoped to the caller
    expect(insertedCategoryIds()).toEqual(["cat-coffee", "cat-food"]);
  });

  it("leaves categoryId alone on conflict unless the flow moves it (KOI-341)", async () => {
    syncWith(["STARBUCKS"], [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }]);

    await syncPlaidItem(ITEM_ID);

    const upsert = mockDb.opsOn(transaction, "insert")[0]!;
    const onConflict = upsert.arg("onConflictDoUpdate") as { set: Record<string, unknown> };
    // The flow-change cases run against Postgres in spend-only-categories-db.test.ts.
    expect(sqlText(onConflict.set.categoryId)).toMatch(/else "transaction"."category_id" end$/);
  });
});

const insertedFlowsAndCategories = () =>
  (mockDb.inserted(transaction) as Array<{ flow: string; categoryId: string | null }>).map((t) => [t.flow, t.categoryId]);

describe("syncPlaidItem with flow rules", () => {
  it("lets a flow rule override the bank's flow, and another rule still set the category", async () => {
    syncWithPrimaries(
      [
        ["VENMO RENT", "TRANSFER_OUT"],
        ["VENMO TO BOB", "TRANSFER_OUT"],
      ],
      [
        existingRule("r1", "venmo rent", null, "2026-01-01", "expense"),
        existingRule("r2", "venmo", "cat-rent"),
      ],
    );

    await syncPlaidItem(ITEM_ID);

    // The transfer takes no category, even from a matching rule (KOI-341).
    expect(insertedFlowsAndCategories()).toEqual([
      ["expense", "cat-rent"],
      ["transfer", null],
    ]);
  });

  it("keeps a hand-set or paired row's flow when the transaction is synced again", async () => {
    syncWithPrimaries([["ZELLE FROM JANE", "TRANSFER_IN"]], [existingRule("r1", "zelle", null, "2026-01-01", "income")]);

    await syncPlaidItem(ITEM_ID);

    const upsert = mockDb.opsOn(transaction, "insert")[0]!;
    const onConflict = upsert.arg("onConflictDoUpdate") as { set: { flow: unknown } };
    expect(sqlText(onConflict.set.flow)).toBe(
      'case when ("transaction"."flow_overridden" = $1 and "transaction"."transfer_pair_id" is null) then excluded.flow else "transaction"."flow" end',
    );
  });
});

describe("syncPlaidItem seeding (KOI-335)", () => {
  it("seeds a new user's categories and Bank Category mapping, then resolves through it", async () => {
    syncWith(["CHIPOTLE 42"], [], false);
    // No categories yet, so the seed inserts them; then the name lookup finds them.
    mockDb.onSelect(category, [], [{ id: "cat-food", name: "Food & Drink" }]);

    await syncPlaidItem(ITEM_ID);

    expect((mockDb.inserted(category) as Array<{ name: string }>).map((c) => c.name)).toContain("Food & Drink");
    expect(mockDb.inserted(bankCategoryMapping)).toContainEqual({
      userId: USER_ID,
      pfcPrimary: "FOOD_AND_DRINK",
      categoryId: "cat-food",
    });
    expect(insertedCategoryIds()).toEqual(["cat-food"]);
  });

  it("never re-creates seeded categories for a user who is already seeded", async () => {
    syncWith(["CHIPOTLE 42"], []);

    await syncPlaidItem(ITEM_ID);

    expect(mockDb.inserted(category)).toEqual([]);
    expect(mockDb.inserted(bankCategoryMapping)).toEqual([]);
    expect(insertedCategoryIds()).toEqual(["cat-food"]);
  });
});
