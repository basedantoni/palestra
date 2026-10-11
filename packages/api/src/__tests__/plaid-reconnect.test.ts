/**
 * Integration tests: reconnecting a broken bank via Plaid Link update mode (KOI-275).
 *
 * - createLinkToken with a plaidItemId issues an update-mode token for an item
 *   the caller owns (access_token set, no products); foreign item → NOT_FOUND
 * - revoked items can't be repaired in update mode (must be re-linked) →
 *   PRECONDITION_FAILED from both createLinkToken and markItemRepaired
 * - markItemRepaired syncs the item and marks it active only if that sync
 *   succeeds; a failed sync leaves it broken; foreign item → NOT_FOUND
 * - linking a bank stores its institution display name; a failed name lookup
 *   never breaks the link
 * - items linked under another PLAID_ENV are refused before Plaid is called, and
 *   linking tags the item with the running PLAID_ENV (KOI-288)
 * - removeItem is scoped to the caller: foreign id → NOT_FOUND (KOI-288)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSync, mockPlaid } = vi.hoisted(() => ({
  mockSync: vi.fn(),
  mockPlaid: {
    linkTokenCreate: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    accountsGet: vi.fn(),
    institutionsGetById: vi.fn(),
    itemRemove: vi.fn(),
  },
}));

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/plaid-sync-db", () => ({ syncPlaidItem: mockSync }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () => KEY,
}));

import { plaidItem } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { encryptToken } from "../lib/token-encryption";
import { env } from "@life-tracker/env/server";
import { otherPlaidEnv } from "../lib/plaid-env";
import { mockDb } from "./helpers/mock-db";

const OTHER_ENV = otherPlaidEnv();

const USER_ID = "user-reconnect-1";
const ITEM_ID = "00000000-0000-4000-8000-0000000000c3";
const ACCESS_TOKEN = "access-sandbox-reconnect";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } }, db: mockDb.db } as any);
}

/**
 * The next plaid_item select returns these rows. The mock ignores filters, so
 * tests prove scoping via the select's WHERE params (`mockDb.selected`).
 */
function itemIs(rows: unknown[]) {
  mockDb.onSelect(plaidItem, rows);
}

const updateSets = () => mockDb.updated(plaidItem).map((u) => u.set);
const insertValues = () => mockDb.inserted(plaidItem) as Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockSync.mockResolvedValue({ added: 0, modified: 0, removed: 0 });
});

describe("plaid.createLinkToken update mode", () => {
  it("issues an update-mode token for an owned item using its access token, without products", async () => {
    itemIs([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "error", plaidEnv: env.PLAID_ENV },
    ]);
    mockPlaid.linkTokenCreate.mockResolvedValueOnce({ data: { link_token: "link-update-1" } });

    const result = await makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID });

    expect(result).toEqual({ linkToken: "link-update-1" });
    expect(mockDb.selected(plaidItem)).toEqual([[ITEM_ID, USER_ID]]);
    const req = mockPlaid.linkTokenCreate.mock.calls[0]![0];
    expect(req.access_token).toBe(ACCESS_TOKEN);
    expect(req.products).toBeUndefined();
    expect(req.user).toEqual({ client_user_id: USER_ID });
  });

  it("rejects an item the caller doesn't own with NOT_FOUND and never calls Plaid", async () => {
    itemIs([]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.selected(plaidItem)).toEqual([[ITEM_ID, USER_ID]]);
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("refuses update mode for a revoked item (Plaid can't repair it) and never calls Plaid", async () => {
    itemIs([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "revoked", plaidEnv: env.PLAID_ENV },
    ]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("refuses update mode for an item linked under another PLAID_ENV and never calls Plaid", async () => {
    itemIs([
      { accessTokenEnc: encryptToken(ACCESS_TOKEN, KEY), status: "error", plaidEnv: OTHER_ENV },
    ]);

    await expect(makeCaller().plaid.createLinkToken({ plaidItemId: ITEM_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: `Linked in ${OTHER_ENV} — switch PLAID_ENV to manage`,
    });
    expect(mockPlaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("still creates a fresh-link token with products when no item is given", async () => {
    mockPlaid.linkTokenCreate.mockResolvedValueOnce({ data: { link_token: "link-new-1" } });

    await expect(makeCaller().plaid.createLinkToken()).resolves.toEqual({ linkToken: "link-new-1" });
    const req = mockPlaid.linkTokenCreate.mock.calls[0]![0];
    expect(req.access_token).toBeUndefined();
    expect(req.products).toEqual(["transactions"]);
  });
});

/** Let un-awaited sync kick-offs settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("plaid.markItemRepaired", () => {
  it("syncs an owned broken item and only then marks it active", async () => {
    itemIs([{ id: ITEM_ID, status: "error" }]);
    mockSync.mockResolvedValueOnce({ added: 4, modified: 1, removed: 0 });

    await expect(makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID })).resolves.toEqual({
      added: 4,
      modified: 1,
      removed: 0,
    });

    expect(mockDb.selected(plaidItem)).toEqual([[ITEM_ID, USER_ID]]);
    expect(mockSync).toHaveBeenCalledWith(ITEM_ID);
    expect(updateSets()).toEqual([{ status: "active" }]);
  });

  it("clears an expiring item once the sync succeeds", async () => {
    itemIs([{ id: ITEM_ID, status: "pending_expiration" }]);

    await makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID });

    expect(updateSets()).toEqual([{ status: "active" }]);
  });

  it("leaves the item broken and reports an error when the follow-up sync fails", async () => {
    itemIs([{ id: ITEM_ID, status: "error" }]);
    mockSync.mockRejectedValueOnce(new Error("ITEM_LOGIN_REQUIRED"));

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(updateSets()).toEqual([]);
  });

  it("refuses a revoked item without syncing or writing", async () => {
    itemIs([{ id: ITEM_ID, status: "revoked" }]);

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockSync).not.toHaveBeenCalled();
    expect(updateSets()).toEqual([]);
  });

  it("rejects an item the caller doesn't own with NOT_FOUND, writing nothing", async () => {
    itemIs([]);

    await expect(
      makeCaller().plaid.markItemRepaired({ plaidItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSets()).toEqual([]);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

function linkSucceeds() {
  mockPlaid.itemPublicTokenExchange.mockResolvedValueOnce({
    data: { access_token: ACCESS_TOKEN, item_id: "plaid-item-1" },
  });
  mockPlaid.accountsGet.mockResolvedValueOnce({
    data: { item: { institution_id: "ins_109508" }, accounts: [] },
  });
  itemIs([{ id: ITEM_ID }]);
}

describe("plaid.exchangePublicToken institution name", () => {
  it("stores the institution's display name on the new item", async () => {
    linkSucceeds();
    mockPlaid.institutionsGetById.mockResolvedValueOnce({
      data: { institution: { name: "First Platypus Bank" } },
    });

    await makeCaller().plaid.exchangePublicToken({ publicToken: "public-1" });
    await flush();

    expect(mockPlaid.institutionsGetById).toHaveBeenCalledWith(
      expect.objectContaining({ institution_id: "ins_109508" }),
    );
    expect(insertValues()[0]).toMatchObject({
      institutionId: "ins_109508",
      institutionName: "First Platypus Bank",
      plaidEnv: env.PLAID_ENV,
    });
  });

  it("links without a name when the institution lookup fails", async () => {
    linkSucceeds();
    mockPlaid.institutionsGetById.mockRejectedValueOnce(new Error("INSTITUTION_NOT_FOUND"));

    await expect(
      makeCaller().plaid.exchangePublicToken({ publicToken: "public-1" }),
    ).resolves.toEqual({ itemId: ITEM_ID, accountCount: 0 });
    await flush();

    expect(insertValues()[0]).toMatchObject({ institutionName: null });
  });
});

describe("plaid.removeItem", () => {
  it("rejects an item the caller doesn't own with NOT_FOUND, revoking and deleting nothing", async () => {
    itemIs([]);

    await expect(
      makeCaller().plaid.removeItem({ plaidItemId: ITEM_ID, force: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.selected(plaidItem)).toEqual([[ITEM_ID, USER_ID]]);
    expect(mockPlaid.itemRemove).not.toHaveBeenCalled();
    expect(mockDb.deleted(plaidItem)).toEqual([]);
  });
});
