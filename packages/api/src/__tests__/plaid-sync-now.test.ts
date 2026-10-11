/**
 * Integration tests: on-demand Plaid sync (KOI-274).
 *
 * - plaid.syncNow syncs every item the caller owns and reports per-item results
 * - one item failing doesn't abort the others; the error is reported per item
 * - revoked items are skipped (Plaid would reject them) and reported as such
 * - items linked under another PLAID_ENV are skipped without calling Plaid (KOI-288)
 * - the item query is scoped to the caller (asserted on the rendered WHERE)
 * - syncNow with a plaidItemId the caller doesn't own → NOT_FOUND, nothing synced
 * - exchangePublicToken kicks off a sync for the new item without waiting on a
 *   webhook, and a sync failure never breaks the link response
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockSync, mockPlaid } = vi.hoisted(() => ({
  mockSync: vi.fn(),
  mockPlaid: { itemPublicTokenExchange: vi.fn(), accountsGet: vi.fn() },
}));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/plaid-sync-db", () => ({ syncPlaidItem: mockSync }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { plaidItem } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";
import { otherPlaidEnv } from "../lib/plaid-env";
import { mockDb } from "./helpers/mock-db";

const OTHER_ENV = otherPlaidEnv();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-plaid-1";
const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b2";

function makeCaller(userId = USER_ID) {
  return appRouter.createCaller({ session: { user: { id: userId } }, db: mockDb.db } as any);
}

/**
 * The next plaid_item select returns these rows. The mock ignores filters, so
 * tests prove scoping via the select's WHERE params (`mockDb.selected`).
 */
function itemsAre(rows: unknown[]) {
  mockDb.onSelect(plaidItem, rows);
}

function item(id: string, status = "active", plaidEnv = env.PLAID_ENV) {
  return { id, institutionName: `Bank ${id.slice(-2)}`, status, plaidEnv };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ────────────────────────────────────────────────────────────────────────────
// plaid.syncNow
// ────────────────────────────────────────────────────────────────────────────
describe("plaid.syncNow", () => {
  it("syncs every item the caller owns and reports per-item counts", async () => {
    itemsAre([item(ITEM_A), item(ITEM_B)]);
    mockSync
      .mockResolvedValueOnce({ added: 3, modified: 1, removed: 0 })
      .mockResolvedValueOnce({ added: 0, modified: 0, removed: 2 });

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(mockSync).toHaveBeenCalledWith(ITEM_B);
    expect(mockDb.selected(plaidItem)).toEqual([[USER_ID]]);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 3, modified: 1, removed: 0 },
      { plaidItemId: ITEM_B, institutionName: "Bank b2", ok: true, added: 0, modified: 0, removed: 2 },
    ]);
  });

  it("keeps syncing other items when one fails, reporting the error for that item", async () => {
    itemsAre([item(ITEM_A), item(ITEM_B)]);
    mockSync
      .mockRejectedValueOnce(new Error("ITEM_LOGIN_REQUIRED"))
      .mockResolvedValueOnce({ added: 1, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({});

    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: false, error: "ITEM_LOGIN_REQUIRED" },
      { plaidItemId: ITEM_B, institutionName: "Bank b2", ok: true, added: 1, modified: 0, removed: 0 },
    ]);
  });

  it("skips revoked items without calling Plaid, reporting them as needing reconnect", async () => {
    itemsAre([item(ITEM_A, "revoked")]);

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        plaidItemId: ITEM_A,
        institutionName: "Bank a1",
        ok: false,
        error: "Access revoked — reconnect this bank",
      },
    ]);
  });

  it("skips items linked under another PLAID_ENV without calling Plaid", async () => {
    itemsAre([item(ITEM_A), item(ITEM_B, "active", OTHER_ENV)]);
    mockSync.mockResolvedValueOnce({ added: 1, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({});

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 1, modified: 0, removed: 0 },
      {
        plaidItemId: ITEM_B,
        institutionName: "Bank b2",
        ok: false,
        skipped: true,
        error: `Linked in ${OTHER_ENV} — switch PLAID_ENV to manage`,
      },
    ]);
  });

  it("reports a foreign revoked item as skipped, not as needing reconnect", async () => {
    itemsAre([item(ITEM_A, "revoked", OTHER_ENV)]);

    const [result] = await makeCaller().plaid.syncNow({});

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("syncs only the requested item when given an id the caller owns", async () => {
    itemsAre([item(ITEM_A)]);
    mockSync.mockResolvedValueOnce({ added: 2, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.syncNow({ plaidItemId: ITEM_A });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
    expect(mockDb.selected(plaidItem)).toEqual([[USER_ID, ITEM_A]]);
    expect(result).toEqual([
      { plaidItemId: ITEM_A, institutionName: "Bank a1", ok: true, added: 2, modified: 0, removed: 0 },
    ]);
  });

  it("rejects an item id the caller doesn't own with NOT_FOUND and syncs nothing", async () => {
    itemsAre([]);

    await expect(makeCaller().plaid.syncNow({ plaidItemId: ITEM_B })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.selected(plaidItem)).toEqual([[USER_ID, ITEM_B]]);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plaid.exchangePublicToken → initial sync
// ────────────────────────────────────────────────────────────────────────────
function linkSucceeds() {
  mockPlaid.itemPublicTokenExchange.mockResolvedValueOnce({
    data: { access_token: "access-sandbox-xyz", item_id: "plaid-item-xyz" },
  });
  mockPlaid.accountsGet.mockResolvedValueOnce({
    data: { item: { institution_id: "ins_1" }, accounts: [] },
  });
  // Resolve the persisted item row id.
  itemsAre([{ id: ITEM_A }]);
}

/** Let the un-awaited sync kick-off settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("plaid.exchangePublicToken initial sync", () => {
  it("kicks off a sync for the newly linked item without waiting on a webhook", async () => {
    linkSucceeds();
    mockSync.mockResolvedValueOnce({ added: 10, modified: 0, removed: 0 });

    const result = await makeCaller().plaid.exchangePublicToken({ publicToken: "public-xyz" });
    await flush();

    expect(result).toEqual({ itemId: ITEM_A, accountCount: 0 });
    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
  });

  it("still returns the link result when the initial sync fails", async () => {
    linkSucceeds();
    mockSync.mockRejectedValueOnce(new Error("PRODUCT_NOT_READY"));

    await expect(
      makeCaller().plaid.exchangePublicToken({ publicToken: "public-xyz" }),
    ).resolves.toEqual({ itemId: ITEM_A, accountCount: 0 });
    await flush();

    expect(mockSync).toHaveBeenCalledWith(ITEM_A);
  });
});
