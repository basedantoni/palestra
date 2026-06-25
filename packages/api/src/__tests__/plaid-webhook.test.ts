/**
 * Integration tests: Plaid webhook endpoint (Seam 2).
 *
 * Covers the persist-then-drain handler behavior:
 * - TRANSACTIONS SYNC_UPDATES_AVAILABLE on a known item → 200, event row
 *   inserted, sync triggered (fire-and-forget)
 * - missing item_id → 400, nothing written
 * - unknown item_id → 200 (ack so Plaid stops retrying), no insert, no sync
 * - ITEM ERROR → 200, plaid_item.status updated, sync NOT triggered
 * - ITEM LOGIN_REPAIRED → status set back to "active"
 * - benign ITEM code (NEW_ACCOUNTS_AVAILABLE) → 200, status NOT changed
 * - non-sync TRANSACTIONS code → 200, event marked done, sync NOT triggered
 * - drainPendingPlaidEvents re-runs a pending event → sync triggered
 *
 * NOTE: the handler does not yet verify the Plaid `plaid-verification` JWT
 * (tracked follow-up), so there is intentionally no 401 path to assert here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockSync } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch") return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally") return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return () => proxy;
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
  };

  return { mockDb, makeChain, mockSync: vi.fn() };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/plaid-sync-db", () => ({ syncPlaidItem: mockSync }));

// Import after mocks are set up
import { drainPendingPlaidEvents, plaidWebhookApp } from "../lib/plaid-webhook";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const ITEM_ID = "item-sandbox-123";
const ITEM_ROW_ID = "00000000-0000-4000-8000-0000000000aa";

let updateSets: Array<Record<string, unknown>>;

function post(body: unknown): Promise<Response> {
  return plaidWebhookApp.fetch(
    new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Next db.select() resolves to a found plaid_item row. */
function itemFound() {
  mockDb.select.mockReturnValueOnce(makeChain([{ id: ITEM_ROW_ID }]));
}
function itemNotFound() {
  mockDb.select.mockReturnValueOnce(makeChain([]));
}

/** Flush fire-and-forget processEvent continuations. */
async function flush() {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
}

beforeEach(() => {
  vi.resetAllMocks();
  updateSets = [];
  mockDb.insert.mockReturnValue(makeChain());
  // Capture every .set() payload; .where() resolves.
  mockDb.update.mockImplementation(() => ({
    set: (val: Record<string, unknown>) => {
      updateSets.push(val);
      return { where: () => makeChain() };
    },
  }));
  mockSync.mockResolvedValue({ added: 1, modified: 0, removed: 0 });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────
describe("POST /webhook — Plaid webhook endpoint", () => {
  it("TRANSACTIONS SYNC_UPDATES_AVAILABLE on a known item → 200, inserts event, triggers sync", async () => {
    itemFound();
    const res = await post({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: ITEM_ID,
    });
    expect(res.status).toBe(200);
    expect(mockDb.insert).toHaveBeenCalledOnce();

    await flush();
    expect(mockSync).toHaveBeenCalledOnce();
    expect(mockSync).toHaveBeenCalledWith(ITEM_ROW_ID);
  });

  it("missing item_id → 400, nothing written", async () => {
    const res = await post({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" });
    expect(res.status).toBe(400);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("unknown item_id → 200 (ack), no insert, no sync", async () => {
    itemNotFound();
    const res = await post({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "nope",
    });
    expect(res.status).toBe(200);
    expect(mockDb.insert).not.toHaveBeenCalled();
    await flush();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("ITEM ERROR → 200, sets status='error', does NOT trigger sync", async () => {
    itemFound();
    const res = await post({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: ITEM_ID });
    expect(res.status).toBe(200);
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(updateSets).toContainEqual({ status: "error" });
    await flush();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("ITEM LOGIN_REPAIRED → sets status back to 'active'", async () => {
    itemFound();
    const res = await post({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: ITEM_ID });
    expect(res.status).toBe(200);
    expect(updateSets).toContainEqual({ status: "active" });
  });

  it("benign ITEM code (NEW_ACCOUNTS_AVAILABLE) → 200, does NOT change status", async () => {
    itemFound();
    const res = await post({
      webhook_type: "ITEM",
      webhook_code: "NEW_ACCOUNTS_AVAILABLE",
      item_id: ITEM_ID,
    });
    expect(res.status).toBe(200);
    // Only the event-done update happens; the item's status is left untouched.
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({ status: "done" });
  });

  it("non-sync TRANSACTIONS code → 200, marks event done, does NOT trigger sync", async () => {
    itemFound();
    const res = await post({
      webhook_type: "TRANSACTIONS",
      webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
      item_id: ITEM_ID,
    });
    expect(res.status).toBe(200);
    expect(mockDb.insert).toHaveBeenCalledOnce();
    await flush();
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("drainPendingPlaidEvents", () => {
  it("re-runs a pending event and triggers sync", async () => {
    // 1st select: pending events; 2nd select: resolve item row for that event.
    mockDb.select.mockReturnValueOnce(makeChain([{ id: "evt-1", itemId: ITEM_ID }]));
    mockDb.select.mockReturnValueOnce(makeChain([{ id: ITEM_ROW_ID }]));

    await drainPendingPlaidEvents();
    await flush();

    expect(mockSync).toHaveBeenCalledWith(ITEM_ROW_ID);
  });
});
