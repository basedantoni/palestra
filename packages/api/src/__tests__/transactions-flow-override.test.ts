/**
 * Integration tests: user flow override that survives Plaid sync (KOI-290).
 *
 * - the sync upsert keeps a user-overridden flow on modified transactions
 * - transactions.setFlow overrides flow (flowOverridden = true), or resets to
 *   automatic (Plaid-derived flow, flowOverridden = false) with null
 * - pending transactions can't be overridden
 * - overriding one leg of a transfer pair unpairs both legs
 * - every read/write is scoped to the caller
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
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

import { transaction } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-flow-override";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const TXN_ID = "00000000-0000-4000-8000-0000000000f1";
const PAIR_ID = "00000000-0000-4000-8000-0000000000aa";

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL);

type Calls = Array<[string, unknown[]]>;
let insertCalls: Array<{ table: unknown; calls: Calls }>;
let updateCalls: Array<{ table: unknown; calls: Calls }>;

function selectReturns(rows: unknown[]) {
  mockDb.select.mockReturnValueOnce(makeChain(rows));
}

/** Next db.select() resolves to these rows and records its WHERE clause. */
function selectCapturingWhere(rows: unknown[]): { params: () => unknown[] } {
  let where: unknown;
  const chain = makeChain(rows);
  mockDb.select.mockReturnValueOnce({
    from: () => ({
      where: (clause: unknown) => {
        where = clause;
        return chain;
      },
    }),
  });
  return { params: () => (where ? render(where).params : []) };
}

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

/** `set` + rendered WHERE of each update against the transaction table. */
function transactionUpdates() {
  return updateCalls
    .filter((u) => u.table === transaction)
    .map(({ calls }) => {
      const set = calls.find(([m]) => m === "set")?.[1][0] as Record<string, unknown>;
      const where = calls.find(([m]) => m === "where")?.[1][0];
      return { set, where: where ? render(where) : undefined };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  updateCalls = [];
  mockDb.insert.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    insertCalls.push({ table, calls });
    return makeChain([], calls);
  });
  mockDb.update.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    updateCalls.push({ table, calls });
    return makeChain([], calls);
  });
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb));
});

// ────────────────────────────────────────────────────────────────────────────
// Sync upsert
// ────────────────────────────────────────────────────────────────────────────
describe("syncPlaidItem upsert", () => {
  it("keeps the stored flow on a modified transaction whose flow was overridden", async () => {
    selectReturns([
      { id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: "c1", plaidEnv: env.PLAID_ENV },
    ]);
    mockPlaid.transactionsSync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [
          {
            transaction_id: "plaid-txn-1",
            account_id: "p_chk",
            amount: -50,
            date: "2026-09-30",
            name: "Venmo",
            pending: false,
            personal_finance_category: { primary: "TRANSFER_IN", detailed: null },
          },
        ],
        removed: [],
        accounts: [],
        next_cursor: "c2",
        has_more: false,
      },
    });
    selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]); // accounts
    selectReturns([]); // categories
    selectReturns([]); // category rules
    selectReturns([]); // transfer candidates

    await syncPlaidItem(ITEM_ID);

    const upsert = insertCalls.find((i) => i.table === transaction)!;
    const onConflict = upsert.calls.find(([m]) => m === "onConflictDoUpdate")?.[1][0] as {
      set: Record<string, unknown>;
    };
    expect(render(onConflict.set.flow).sql).toBe(
      'case when "transaction"."flow_overridden" then "transaction"."flow" else excluded.flow end',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// transactions.setFlow
// ────────────────────────────────────────────────────────────────────────────
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: TXN_ID,
    pending: false,
    plaidCategoryPrimary: "TRANSFER_IN",
    transferPairId: null,
    ...overrides,
  };
}

describe("transactions.setFlow", () => {
  it("overrides flow and marks it overridden, scoped to the caller", async () => {
    const lookup = selectCapturingWhere([row()]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" });

    expect(lookup.params()).toEqual([TXN_ID, USER_ID]);
    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ flow: "income", flowOverridden: true });
    expect(update!.where!.params).toEqual([TXN_ID, USER_ID]);
  });

  it("resets to automatic: restores the Plaid-derived flow and clears the flag", async () => {
    selectReturns([row({ plaidCategoryPrimary: "TRANSFER_IN" })]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: null });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ flow: "transfer", flowOverridden: false });
    expect(update!.where!.params).toEqual([TXN_ID, USER_ID]);
  });

  it("unpairs both legs when overriding one leg of a transfer pair", async () => {
    selectReturns([row({ transferPairId: PAIR_ID })]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" });

    const updates = transactionUpdates();
    expect(updates).toHaveLength(2);
    expect(updates).toContainEqual(
      expect.objectContaining({ set: { flow: "income", flowOverridden: true } }),
    );
    const unpair = updates.find((u) => "transferPairId" in u.set)!;
    expect(unpair.set).toEqual({ transferPairId: null });
    expect(unpair.where!.params).toEqual([PAIR_ID, USER_ID]);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("leaves pairing alone for an unpaired transaction", async () => {
    selectReturns([row()]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "expense" });

    expect(transactionUpdates()).toHaveLength(1);
  });

  it("rejects a pending transaction and writes nothing", async () => {
    selectReturns([row({ pending: true })]);

    await expect(
      makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transactionUpdates()).toEqual([]);
  });

  it("rejects a transaction the caller doesn't own with NOT_FOUND", async () => {
    selectReturns([]);

    await expect(
      makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(transactionUpdates()).toEqual([]);
  });
});
