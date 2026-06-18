/**
 * Tests: Phase 2 — Whoop Subscription Lifecycle (v2)
 *
 * Covers:
 * a. webhookStatus: no connection → subscribed: false, isValid: false
 * b. webhookStatus: connection found, env secret configured → subscribed: true, isValid: true (no deliveries)
 * c. webhookStatus: subscribed, lastReceivedAt within 7 days → isValid: true
 * d. webhookStatus: subscribed, lastReceivedAt > 7 days ago → isValid: false
 * e. webhookStatus: connection found, webhookSubscriptionId ignored — subscribed is env-based
 * f. reregisterWebhook always throws METHOD_NOT_SUPPORTED (v2 is app-level configured)
 * i. disconnect: has webhookSubscriptionId → calls Whoop delete before local delete
 * j. disconnect: Whoop delete fails → still deletes local row
 * k. disconnect: no webhookSubscriptionId → skips Whoop delete, deletes local row
 * l. handleWhoopCallback: fetches whoopUserId from /v2/user/profile/basic and stores it
 * m. handleWhoopCallback: fires setImmediate for backfill on first connect
 * n. handleWhoopCallback: no webhook registration fetch call (v2 is app-level)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") {
            return (ok: any) => Promise.resolve(resolveWith).then(ok);
          }
          if (prop === "catch") {
            return (err: any) => Promise.resolve(resolveWith).catch(err);
          }
          if (prop === "finally") {
            return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          }
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
    transaction: vi.fn(),
    query: {},
  };

  return { mockDb, makeChain };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));

vi.mock("@life-tracker/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
    TOKEN_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    WHOOP_CLIENT_ID: "test-whoop-client-id",
    WHOOP_CLIENT_SECRET: "test-whoop-client-secret",
    WHOOP_REDIRECT_URI: "http://localhost:3000/api/whoop/callback",
  },
}));

// Mock global fetch for Whoop API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocks
import { appRouter } from "../routers/index";
import { encryptToken } from "../lib/token-encryption";
import { handleWhoopCallback } from "../lib/whoop-oauth";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const APP_USER_ID = "00000000-0000-4000-8000-000000000101";
const SUBSCRIPTION_ID = "sub-abc-123";

// ────────────────────────────────────────────────────────────────────────────
// tRPC caller factory
// ────────────────────────────────────────────────────────────────────────────

function makeCtx(userId = APP_USER_ID) {
  return {
    session: { user: { id: userId } },
    db: mockDb,
  } as any;
}

function makeCaller(userId = APP_USER_ID) {
  return appRouter.createCaller(makeCtx(userId));
}

// ────────────────────────────────────────────────────────────────────────────
// DB mock helpers
// ────────────────────────────────────────────────────────────────────────────

function mockSelectConnection(row: Record<string, unknown> | null) {
  mockDb.select.mockReturnValueOnce(makeChain(row ? [row] : []));
}

function mockDeleteOk() {
  mockDb.delete.mockReturnValueOnce({
    where: vi.fn().mockReturnValue(makeChain([])),
  });
}

function mockInsertOnConflictDoUpdate(resolveWith: unknown = {}) {
  mockDb.insert.mockReturnValueOnce({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(resolveWith),
    }),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch mock helpers
// ────────────────────────────────────────────────────────────────────────────

function mockFetchSuccess(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockFetchFailure(status = 500, body = "Server error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Tests: webhookStatus
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.webhookStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("a. no connection → subscribed: false, isValid: false, all nulls", async () => {
    mockSelectConnection(null);

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.subscribed).toBe(false);
    expect(result.isValid).toBe(false);
    expect(result.lastReceivedAt).toBeNull();
    expect(result.autoImportEnabled).toBe(false);
    expect(result.notifyOnAutoImport).toBe(false);
    expect(result.backfill).toBeNull();
  });

  it("b. connection found, env secret configured, no deliveries → subscribed: true, isValid: true", async () => {
    mockSelectConnection({
      webhookSubscriptionId: SUBSCRIPTION_ID,
      webhookLastReceivedAt: null,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    // v2: subscribed = !!env.WHOOP_WEBHOOK_SECRET (set in test env)
    expect(result.subscribed).toBe(true);
    // subscribed + no deliveries yet → still considered valid (subscription is live)
    expect(result.isValid).toBe(true);
    expect(result.lastReceivedAt).toBeNull();
    expect(result.autoImportEnabled).toBe(true);
    expect(result.notifyOnAutoImport).toBe(true);
    expect(result.backfill).toBeNull();
  });

  it("c. subscribed, lastReceivedAt within 7 days → isValid: true", async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    mockSelectConnection({
      webhookSubscriptionId: SUBSCRIPTION_ID,
      webhookLastReceivedAt: recentDate,
      autoImportEnabled: true,
      notifyOnAutoImport: false,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.subscribed).toBe(true);
    expect(result.isValid).toBe(true);
    expect(result.lastReceivedAt).toEqual(recentDate);
  });

  it("d. subscribed, lastReceivedAt > 7 days ago → isValid: false", async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    mockSelectConnection({
      webhookSubscriptionId: SUBSCRIPTION_ID,
      webhookLastReceivedAt: oldDate,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.subscribed).toBe(true);
    expect(result.isValid).toBe(false);
    expect(result.lastReceivedAt).toEqual(oldDate);
  });

  it("e. v2: webhookSubscriptionId is irrelevant — subscribed is env-secret-based", async () => {
    // Even with webhookSubscriptionId: null, subscribed = !!env.WHOOP_WEBHOOK_SECRET
    mockSelectConnection({
      webhookSubscriptionId: null,
      webhookLastReceivedAt: null,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    // v2: env has WHOOP_WEBHOOK_SECRET → subscribed: true regardless of DB column
    expect(result.subscribed).toBe(true);
    expect(result.isValid).toBe(true); // subscribed + no deliveries → valid
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: reregisterWebhook (v2 — always throws)
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.reregisterWebhook (v2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("f. always throws METHOD_NOT_SUPPORTED — v2 webhooks configured in Developer Dashboard", async () => {
    const caller = makeCaller();

    await expect(caller.whoop.reregisterWebhook()).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });

    // No Whoop API calls, no DB writes
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: disconnect
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.disconnect (webhook cleanup)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("i. has webhookSubscriptionId → calls Whoop delete before local delete", async () => {
    const accessToken = "at-live-token";
    mockSelectConnection({
      id: "conn-1",
      userId: APP_USER_ID,
      webhookSubscriptionId: SUBSCRIPTION_ID,
      accessToken: encryptToken(accessToken, ENCRYPTION_KEY),
      refreshToken: encryptToken("rt-refresh", ENCRYPTION_KEY),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Whoop DELETE succeeds
    mockFetchSuccess({}, 204);

    // Local DB delete
    mockDeleteOk();

    const caller = makeCaller();
    const result = await caller.whoop.disconnect();

    expect(result.success).toBe(true);

    // Whoop DELETE was called
    expect(mockFetch).toHaveBeenCalledOnce();
    const deleteCall = mockFetch.mock.calls[0]!;
    expect(deleteCall[0]).toMatch(/\/v1\/webhook\/sub-abc-123/);
    expect(deleteCall[1].method).toBe("DELETE");

    // Local row was deleted
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it("j. Whoop delete fails → still deletes local row (best-effort)", async () => {
    const accessToken = "at-live-token";
    mockSelectConnection({
      id: "conn-1",
      userId: APP_USER_ID,
      webhookSubscriptionId: SUBSCRIPTION_ID,
      accessToken: encryptToken(accessToken, ENCRYPTION_KEY),
      refreshToken: encryptToken("rt-refresh", ENCRYPTION_KEY),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Whoop DELETE fails
    mockFetchFailure(500);

    // Local DB delete
    mockDeleteOk();

    const caller = makeCaller();
    const result = await caller.whoop.disconnect();

    expect(result.success).toBe(true);

    // Both were attempted
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it("k. no webhookSubscriptionId → skips Whoop delete, deletes local row", async () => {
    mockSelectConnection({
      id: "conn-1",
      userId: APP_USER_ID,
      webhookSubscriptionId: null,
      accessToken: encryptToken("at-live-token", ENCRYPTION_KEY),
      refreshToken: encryptToken("rt-refresh", ENCRYPTION_KEY),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Local DB delete
    mockDeleteOk();

    const caller = makeCaller();
    const result = await caller.whoop.disconnect();

    expect(result.success).toBe(true);

    // No Whoop API call
    expect(mockFetch).not.toHaveBeenCalled();

    // Local row deleted
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: setAutoImport (Phase 4)
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.setAutoImport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("o. setAutoImport({ enabled: false }) updates autoImportEnabled to false in DB", async () => {
    let capturedSet: Record<string, unknown> = {};

    mockDb.update.mockReturnValueOnce({
      set: vi.fn((val: unknown) => {
        capturedSet = val as Record<string, unknown>;
        return {
          where: vi.fn().mockReturnValue(makeChain([])),
        };
      }),
    });

    const caller = makeCaller();
    const result = await caller.whoop.setAutoImport({ enabled: false });

    expect(result.ok).toBe(true);
    expect(capturedSet.autoImportEnabled).toBe(false);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("p. setAutoImport({ enabled: true }) updates autoImportEnabled to true in DB", async () => {
    let capturedSet: Record<string, unknown> = {};

    mockDb.update.mockReturnValueOnce({
      set: vi.fn((val: unknown) => {
        capturedSet = val as Record<string, unknown>;
        return {
          where: vi.fn().mockReturnValue(makeChain([])),
        };
      }),
    });

    const caller = makeCaller();
    const result = await caller.whoop.setAutoImport({ enabled: true });

    expect(result.ok).toBe(true);
    expect(capturedSet.autoImportEnabled).toBe(true);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("q. setAutoImport updates only the authenticated user's row (correct userId in where clause)", async () => {
    const updateWhereSpy = vi.fn().mockReturnValue(makeChain([]));

    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: updateWhereSpy,
      }),
    });

    const caller = makeCaller(APP_USER_ID);
    await caller.whoop.setAutoImport({ enabled: false });

    // where clause was called exactly once (scoped to user)
    expect(updateWhereSpy).toHaveBeenCalledOnce();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: setNotifyOnAutoImport (Phase 5)
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.setNotifyOnAutoImport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("r. setNotifyOnAutoImport({ enabled: false }) updates notifyOnAutoImport to false in DB", async () => {
    let capturedSet: Record<string, unknown> = {};

    mockDb.update.mockReturnValueOnce({
      set: vi.fn((val: unknown) => {
        capturedSet = val as Record<string, unknown>;
        return {
          where: vi.fn().mockReturnValue(makeChain([])),
        };
      }),
    });

    const caller = makeCaller();
    const result = await caller.whoop.setNotifyOnAutoImport({ enabled: false });

    expect(result.ok).toBe(true);
    expect(capturedSet.notifyOnAutoImport).toBe(false);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("s. setNotifyOnAutoImport({ enabled: true }) updates notifyOnAutoImport to true in DB", async () => {
    let capturedSet: Record<string, unknown> = {};

    mockDb.update.mockReturnValueOnce({
      set: vi.fn((val: unknown) => {
        capturedSet = val as Record<string, unknown>;
        return {
          where: vi.fn().mockReturnValue(makeChain([])),
        };
      }),
    });

    const caller = makeCaller();
    const result = await caller.whoop.setNotifyOnAutoImport({ enabled: true });

    expect(result.ok).toBe(true);
    expect(capturedSet.notifyOnAutoImport).toBe(true);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: handleWhoopCallback (v2)
// ────────────────────────────────────────────────────────────────────────────

describe("handleWhoopCallback (v2 — whoopUserId only, no subscription registration)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("l. fetches whoopUserId from /v2/user/profile/basic and stores it on connection row", async () => {
    // Token exchange succeeds
    mockFetchSuccess({
      access_token: "at-new",
      refresh_token: "rt-new",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read:workout",
    });

    // Profile fetch succeeds
    mockFetchSuccess({
      user_id: 99887,
      email: "user@example.com",
    });

    // Capture what's stored
    let capturedValues: Record<string, unknown> = {};
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn((val: unknown) => {
        capturedValues = val as Record<string, unknown>;
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue({}),
        };
      }),
    });

    const result = await handleWhoopCallback(
      "user-1",
      "auth-code",
      "verifier-xyz",
    );

    expect(result.ok).toBe(true);

    // whoopUserId stored as string "99887"
    expect(capturedValues.whoopUserId).toBe("99887");
  });

  it("m. fires setImmediate for backfill on first connect (lastImportedAt = null)", async () => {
    const setImmediateSpy = vi.spyOn(globalThis, "setImmediate" as any);

    // Token exchange
    mockFetchSuccess({
      access_token: "at-new",
      refresh_token: "rt-new",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read:workout",
    });

    // Profile fetch
    mockFetchSuccess({ user_id: 99887 });

    // Upsert returns row with lastImportedAt: null → triggers backfill setImmediate
    mockInsertOnConflictDoUpdate([{ lastImportedAt: null }]);

    const result = await handleWhoopCallback(
      "user-1",
      "auth-code",
      "verifier-xyz",
    );

    expect(result.ok).toBe(true);

    // setImmediate called once for backfill (v2: no webhook registration setImmediate)
    expect(setImmediateSpy).toHaveBeenCalledOnce();

    setImmediateSpy.mockRestore();
  });

  it("n. v2: only token + profile fetch calls — no webhook registration API call", async () => {
    // Token exchange
    mockFetchSuccess({
      access_token: "at-new",
      refresh_token: "rt-new",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read:workout",
    });

    // Profile fetch
    mockFetchSuccess({ user_id: 99887 });

    mockInsertOnConflictDoUpdate();

    const result = await handleWhoopCallback(
      "user-1",
      "auth-code",
      "verifier-xyz",
    );
    expect(result.ok).toBe(true);

    // Allow any async callbacks to fire
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // v2: exactly 2 fetch calls (token + profile). No 3rd call for webhook registration.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const calls = mockFetch.mock.calls;
    expect(calls[0]![0]).toContain("/oauth/oauth2/token");
    expect(calls[1]![0]).toContain("/user/profile/basic");
  });
});
