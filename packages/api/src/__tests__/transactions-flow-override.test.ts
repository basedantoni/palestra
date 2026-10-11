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
const { mockPlaid } = vi.hoisted(() => ({ mockPlaid: { transactionsSync: vi.fn() } }));

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

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { financialAccount, plaidItem, transaction } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";
import { mockDb } from "./helpers/mock-db";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-flow-override";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const TXN_ID = "00000000-0000-4000-8000-0000000000f1";
const PAIR_ID = "00000000-0000-4000-8000-0000000000aa";

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL);

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Sync upsert
// ────────────────────────────────────────────────────────────────────────────
describe("syncPlaidItem upsert", () => {
  it("keeps the stored flow on a modified transaction whose flow was overridden", async () => {
    mockDb.onSelect(plaidItem, [
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
    mockDb.onSelect(financialAccount, [{ id: "fa-chk", plaidAccountId: "p_chk" }]);
    // Categories, category rules and transfer candidates: nothing queued, so [].

    await syncPlaidItem(ITEM_ID);

    const upsert = mockDb.opsOn(transaction).find((op) => op.kind === "insert")!;
    const onConflict = upsert.arg("onConflictDoUpdate") as {
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
    mockDb.onSelect(transaction, [row()]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" });

    expect(mockDb.selected(transaction)).toEqual([[TXN_ID, USER_ID]]);
    const [update] = mockDb.updated(transaction);
    expect(update!.set).toEqual({ flow: "income", flowOverridden: true });
    expect(update!.where).toEqual([TXN_ID, USER_ID]);
  });

  it("resets to automatic: restores the Plaid-derived flow and clears the flag", async () => {
    mockDb.onSelect(transaction, [row({ plaidCategoryPrimary: "TRANSFER_IN" })]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: null });

    const [update] = mockDb.updated(transaction);
    expect(update!.set).toEqual({ flow: "transfer", flowOverridden: false });
    expect(update!.where).toEqual([TXN_ID, USER_ID]);
  });

  it("unpairs both legs when overriding one leg of a transfer pair", async () => {
    mockDb.onSelect(transaction, [row({ transferPairId: PAIR_ID })]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" });

    const updates = mockDb.updated(transaction) as Array<{ set: Record<string, unknown>; where: unknown[] }>;
    expect(updates).toHaveLength(2);
    expect(updates).toContainEqual(
      expect.objectContaining({ set: { flow: "income", flowOverridden: true } }),
    );
    const unpair = updates.find((u) => "transferPairId" in u.set)!;
    expect(unpair.set).toEqual({ transferPairId: null });
    expect(unpair.where).toEqual([PAIR_ID, USER_ID]);
    expect(mockDb.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("leaves pairing alone for an unpaired transaction", async () => {
    mockDb.onSelect(transaction, [row()]);

    await makeCaller().transactions.setFlow({ id: TXN_ID, flow: "expense" });

    expect(mockDb.updated(transaction)).toHaveLength(1);
  });

  it("rejects a pending transaction and writes nothing", async () => {
    mockDb.onSelect(transaction, [row({ pending: true })]);

    await expect(
      makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.updated(transaction)).toEqual([]);
  });

  it("rejects a transaction the caller doesn't own with NOT_FOUND", async () => {
    // Nothing queued: the lookup finds no transaction.
    await expect(
      makeCaller().transactions.setFlow({ id: TXN_ID, flow: "income" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.updated(transaction)).toEqual([]);
  });
});
