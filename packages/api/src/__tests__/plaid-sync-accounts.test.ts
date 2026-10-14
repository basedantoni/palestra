/**
 * Plaid sync adds unknown accounts and recovers their dropped transactions
 * (KOI-317), against a real Postgres (PGlite): the transaction upsert on the
 * Plaid id, the account unique index and the cascades run for real. Plaid is a
 * fake bank: a full history on a fresh cursor, an empty delta otherwise.
 *
 * - an account at a linked bank with no local row is created on sync, and the
 *   bank's history is re-pulled so its earlier transactions land
 * - the re-pull doesn't duplicate, and keeps a Manual Category and a flow override
 * - a removed account is recorded on the bank; sync neither recreates it nor
 *   stores its transactions
 * - re-linking the bank clears that record and brings the account back with history
 * - the post-reconnect sync picks up newly shared accounts
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPlaid } = vi.hoisted(() => ({
  mockPlaid: {
    accountsGet: vi.fn(),
    transactionsSync: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    institutionsGetById: vi.fn(),
    itemRemove: vi.fn(),
  },
}));

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));
vi.mock("../lib/token-encryption", () => ({
  encryptToken: (token: string) => token,
  decryptToken: (enc: string) => enc,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () => "key",
}));

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem, transaction } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";

import { removeFinancialAccount } from "../lib/plaid-account-remove";
import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-plaid-sync-accounts";
const CHECKING = `acct-${USER}`;
const KNOWN_TXN = `txn-${USER}`;
const OLD_CURSOR = "cursor-old";
const FULL_CURSOR = "cursor-full";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);

function plaidAccount(accountId: string) {
  return {
    account_id: accountId,
    name: `Account ${accountId}`,
    type: "depository",
    subtype: "checking",
    balances: { current: 100, available: 100, iso_currency_code: "USD" },
  };
}

function plaidTxn(transactionId: string, accountId: string, primary = "FOOD_AND_DRINK") {
  return {
    transaction_id: transactionId,
    account_id: accountId,
    amount: 42,
    date: "2026-09-15",
    name: "MOVEMENT CLIMBING GYM",
    pending: false,
    personal_finance_category: { primary, detailed: `${primary}_OTHER` },
    iso_currency_code: "USD",
  };
}

/**
 * The bank as Plaid sees it. A fresh cursor gets the full `history`; a known
 * cursor gets `delta` — so transactions dropped earlier only come back on a re-pull.
 */
function bankHas(bank: {
  accounts: string[];
  history: ReturnType<typeof plaidTxn>[];
  delta?: ReturnType<typeof plaidTxn>[];
}) {
  mockPlaid.accountsGet.mockResolvedValue({
    data: { item: { institution_id: null }, accounts: bank.accounts.map(plaidAccount) },
  });
  mockPlaid.transactionsSync.mockImplementation(async ({ cursor }: { cursor?: string }) => ({
    data: {
      added: cursor ? (bank.delta ?? []) : bank.history,
      modified: [],
      removed: [],
      next_cursor: FULL_CURSOR,
      has_more: false,
    },
  }));
}

/** The seeded user's bank, checking account and one categorized transaction, last synced at OLD_CURSOR. */
async function seedBank() {
  const seeded = await seedFinanceUser(db, USER);
  const [item] = await db
    .update(plaidItem)
    .set({ transactionCursor: OLD_CURSOR, plaidEnv: env.PLAID_ENV })
    .where(eq(plaidItem.userId, USER))
    .returning();
  return { ...seeded, item: item! };
}

async function addAccount(plaidItemId: string, plaidAccountId: string) {
  const id = randomUUID();
  await db.insert(financialAccount).values({
    id,
    userId: USER,
    plaidItemId,
    plaidAccountId,
    name: plaidAccountId,
    type: "depository",
  });
  return id;
}

async function accountByPlaidId(plaidAccountId: string) {
  const [row] = await db
    .select()
    .from(financialAccount)
    .where(eq(financialAccount.plaidAccountId, plaidAccountId));
  return row;
}

async function transactionsOn(accountId: string) {
  return db.select().from(transaction).where(eq(transaction.accountId, accountId));
}

async function itemRow(id: string) {
  const [row] = await db.select().from(plaidItem).where(eq(plaidItem.id, id));
  return row!;
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await truncateAll(db);
});

describe("syncPlaidItem: accounts the app has no row for", () => {
  it("creates the account and stores its back history from a full re-pull", async () => {
    const { item } = await seedBank();
    bankHas({
      accounts: [CHECKING, "p_new"],
      history: [plaidTxn(KNOWN_TXN, CHECKING), plaidTxn("txn-new-1", "p_new"), plaidTxn("txn-new-2", "p_new")],
    });

    await syncPlaidItem(item.id);

    const created = await accountByPlaidId("p_new");
    expect(created).toMatchObject({ userId: USER, plaidItemId: item.id, source: "plaid" });
    expect((await transactionsOn(created!.id)).map((t) => t.plaidTransactionId).toSorted()).toEqual([
      "txn-new-1",
      "txn-new-2",
    ]);
    // The re-pull started from scratch, and the known transaction wasn't duplicated.
    expect(mockPlaid.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: undefined }),
    );
    expect(await db.select().from(transaction).where(eq(transaction.plaidTransactionId, KNOWN_TXN))).toHaveLength(1);
    expect((await itemRow(item.id)).transactionCursor).toBe(FULL_CURSOR);
  });

  it("re-pulls history only when an account was added", async () => {
    const { item } = await seedBank();
    bankHas({ accounts: [CHECKING], history: [] });

    await syncPlaidItem(item.id);

    expect(mockPlaid.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: OLD_CURSOR }),
    );
  });

  it("keeps a Manual Category and a flow override through the re-pull", async () => {
    const { item, categoryId, transactionId } = await seedBank();
    await db
      .update(transaction)
      .set({ categoryOverridden: true, flow: "transfer", flowOverridden: true })
      .where(eq(transaction.id, transactionId));
    bankHas({
      accounts: [CHECKING, "p_new"],
      history: [plaidTxn(KNOWN_TXN, CHECKING, "GENERAL_MERCHANDISE"), plaidTxn("txn-new-1", "p_new")],
    });

    await syncPlaidItem(item.id);

    const [known] = await db.select().from(transaction).where(eq(transaction.id, transactionId));
    expect(known).toMatchObject({
      categoryId,
      categoryOverridden: true,
      flow: "transfer",
      flowOverridden: true,
      plaidCategoryPrimary: "GENERAL_MERCHANDISE",
    });
  });

  it("recovers on the next sync when the re-pull fails after the account was added", async () => {
    const { item } = await seedBank();
    bankHas({ accounts: [CHECKING, "p_new"], history: [plaidTxn("txn-new-1", "p_new")] });
    mockPlaid.transactionsSync.mockRejectedValueOnce(new Error("PLAID_DOWN"));

    await expect(syncPlaidItem(item.id)).rejects.toThrow("PLAID_DOWN");
    await syncPlaidItem(item.id);

    expect(await transactionsOn((await accountByPlaidId("p_new"))!.id)).toHaveLength(1);
  });
});

describe("removed accounts", () => {
  it("are recorded on the bank, and later syncs neither recreate them nor store their transactions", async () => {
    const { item } = await seedBank();
    const savingsId = await addAccount(item.id, "p_sav");

    await expect(removeFinancialAccount(USER, savingsId)).resolves.toEqual({
      removed: true,
      itemRemoved: false,
    });
    expect((await itemRow(item.id)).removedPlaidAccountIds).toEqual(["p_sav"]);

    bankHas({
      accounts: [CHECKING, "p_sav"],
      history: [plaidTxn("txn-sav-1", "p_sav")],
      delta: [plaidTxn("txn-sav-2", "p_sav")],
    });
    await syncPlaidItem(item.id);

    expect(await accountByPlaidId("p_sav")).toBeUndefined();
    expect(
      await db
        .select()
        .from(transaction)
        .where(and(eq(transaction.userId, USER), eq(transaction.plaidTransactionId, "txn-sav-2"))),
    ).toEqual([]);
    expect(mockPlaid.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: OLD_CURSOR }),
    );
  });

  it("come back with their history when the bank is re-linked through Link", async () => {
    const { item } = await seedBank();
    await removeFinancialAccount(USER, await addAccount(item.id, "p_sav"));
    bankHas({ accounts: [CHECKING, "p_sav"], history: [plaidTxn("txn-sav-1", "p_sav")] });
    mockPlaid.itemPublicTokenExchange.mockResolvedValue({
      data: { access_token: "access-relinked", item_id: item.itemId },
    });

    await makeCaller().plaid.exchangePublicToken({ publicToken: "public-1" });

    expect((await itemRow(item.id)).removedPlaidAccountIds).toEqual([]);
    const savings = await accountByPlaidId("p_sav");
    expect(savings).toMatchObject({ plaidItemId: item.id });
    // The fire-and-forget initial sync re-pulls the returned account's history.
    await vi.waitFor(async () =>
      expect((await itemRow(item.id)).transactionCursor).toBe(FULL_CURSOR),
    );
    expect(await transactionsOn(savings!.id)).toHaveLength(1);
  });
});

describe("reconnect (update mode)", () => {
  it("picks up accounts newly shared during the reconnect", async () => {
    const { item } = await seedBank();
    await db.update(plaidItem).set({ status: "login_required" }).where(eq(plaidItem.id, item.id));
    bankHas({ accounts: [CHECKING, "p_shared"], history: [plaidTxn("txn-shared-1", "p_shared")] });

    await makeCaller().plaid.markItemRepaired({ plaidItemId: item.id });

    const shared = await accountByPlaidId("p_shared");
    expect(shared).toMatchObject({ plaidItemId: item.id });
    expect(await transactionsOn(shared!.id)).toHaveLength(1);
  });
});
