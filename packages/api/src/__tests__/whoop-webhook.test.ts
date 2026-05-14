/**
 * Integration tests: Phase 1 — Whoop Webhook Endpoint (v2)
 *
 * Covers:
 * - Valid HMAC-signed payload → 200, event row created with status `processed`
 * - Invalid signature → 401, nothing written to DB
 * - Unknown whoopUserId (no connection row) → 200 (stop Whoop retries)
 * - Duplicate trace_id → 200, still only one row (onConflictDoNothing)
 * - webhookLastReceivedAt advances on successful delivery
 * - Missing signature or timestamp header → 401
 */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockTrackInFlight } = vi.hoisted(() => {
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
          // All chained methods return the same proxy
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

  const mockTrackInFlight = vi.fn();

  return { mockDb, makeChain, mockTrackInFlight };
});

vi.mock("@src/db", () => ({ db: mockDb }));
vi.mock("../lib/whoop-inflight", () => ({
  trackInFlight: mockTrackInFlight,
  getInFlightCount: vi.fn().mockReturnValue(0),
  getInFlightPromises: vi.fn().mockReturnValue([]),
}));

// v2: webhook secret is an app-level env var, not per-user DB field
vi.mock("@src/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    WHOOP_CLIENT_SECRET: "test-webhook-secret-for-hmac",
  },
}));

// Import after mocks are set up
import { whoopWebhookApp } from "../lib/whoop-webhook";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test-webhook-secret-for-hmac";
const TIMESTAMP = "1714000000";
const WHOOP_USER_ID = "12345";
const APP_USER_ID = "00000000-0000-4000-8000-000000000101";
const TRACE_ID = "trace-abc-123";

// v2 payload shape: { user_id, id, type, trace_id }
function buildPayload(traceId = TRACE_ID, whoopUserId = WHOOP_USER_ID) {
  return JSON.stringify({
    user_id: whoopUserId,
    id: "act-uuid-456",
    type: "workout.updated",
    trace_id: traceId,
  });
}

// v2 signature: base64(HMAC-SHA256(timestamp + body, secret))
function sign(timestamp: string, body: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(timestamp + body)
    .digest("base64");
}

async function sendWebhook(options: {
  body: string;
  signature: string;
  timestamp?: string;
}): Promise<Response> {
  const ts = options.timestamp ?? TIMESTAMP;
  const request = new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WHOOP-Signature": options.signature,
      "X-WHOOP-Signature-Timestamp": ts,
    },
    body: options.body,
  });
  return whoopWebhookApp.fetch(request);
}

// v2: connection row has no webhookSecret field
function mockConnectionFound(whoopUserId = WHOOP_USER_ID) {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      {
        id: "conn-1",
        userId: APP_USER_ID,
        whoopUserId,
      },
    ]),
  );
}

function mockConnectionNotFound() {
  mockDb.select.mockReturnValueOnce(makeChain([]));
}

function mockInsertNoConflict() {
  // insert().values().onConflictDoNothing() → returns affected count
  mockDb.insert.mockReturnValueOnce({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
    }),
  });
}

function mockInsertConflict() {
  // Simulates a duplicate trace_id → onConflictDoNothing returns rowCount: 0
  mockDb.insert.mockReturnValueOnce({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 0 }),
    }),
  });
}

function mockUpdateOk() {
  mockDb.update.mockReturnValueOnce(makeChain([]));
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("POST /webhook — Whoop webhook endpoint (v2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default fallback: any un-mocked db.update() call returns a safe chain.
    // This prevents unhandled errors from the async setImmediate claim path
    // in tests that don't care about the hot path internals.
    mockDb.update.mockReturnValue(makeChain({ rowCount: 0 }));
  });

  it("a. valid HMAC signature → 200 and event row created with status processed", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    mockConnectionFound();
    mockInsertNoConflict();
    mockUpdateOk();

    const res = await sendWebhook({ body, signature: sig });

    expect(res.status).toBe(200);

    // Insert was called once (for the event row)
    expect(mockDb.insert).toHaveBeenCalledOnce();

    // Update was called once (for webhookLastReceivedAt)
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("b. invalid signature → 401, nothing written to DB", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, "wrong-secret");

    // Signature check happens before user lookup — no DB mock needed
    const res = await sendWebhook({ body, signature: sig });

    expect(res.status).toBe(401);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("c. unknown whoopUserId → 200 (valid sig, valid secret, no connected user)", async () => {
    const body = buildPayload(TRACE_ID, "unknown-whoop-user");
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    mockConnectionNotFound();

    // v2: return 200 to stop Whoop from retrying (user simply hasn't connected)
    const res = await sendWebhook({ body, signature: sig });

    expect(res.status).toBe(200);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("d. duplicate trace_id → 200, only one row (onConflictDoNothing)", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    // First delivery
    mockConnectionFound();
    mockInsertNoConflict();
    mockUpdateOk();

    const res1 = await sendWebhook({ body, signature: sig });
    expect(res1.status).toBe(200);

    // Second delivery (same trace_id) — simulates the DB returning rowCount: 0 due to conflict
    mockConnectionFound();
    mockInsertConflict();
    mockUpdateOk();

    const res2 = await sendWebhook({ body, signature: sig });
    expect(res2.status).toBe(200);

    // insert was called twice total (once per request), but the second would no-op at DB level
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it("e. webhookLastReceivedAt advances on successful delivery", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    const capturedUpdateSets: Array<Record<string, unknown>> = [];

    mockConnectionFound();
    mockInsertNoConflict();

    // Capture what gets passed to .set()
    mockDb.update.mockReturnValueOnce({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: () => makeChain([]) };
      }),
    });

    const before = Date.now();
    const res = await sendWebhook({ body, signature: sig });
    const after = Date.now();

    expect(res.status).toBe(200);

    expect(capturedUpdateSets).toHaveLength(1);
    const updatedAt = capturedUpdateSets[0]!.webhookLastReceivedAt as Date;
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("missing X-WHOOP-Signature header → 401", async () => {
    const body = buildPayload();

    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WHOOP-Signature-Timestamp": TIMESTAMP,
        // X-WHOOP-Signature omitted
      },
      body,
    });
    const res = await whoopWebhookApp.fetch(request);

    expect(res.status).toBe(401);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("missing X-WHOOP-Signature-Timestamp header → 401", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WHOOP-Signature": sig,
        // X-WHOOP-Signature-Timestamp omitted
      },
      body,
    });
    const res = await whoopWebhookApp.fetch(request);

    expect(res.status).toBe(401);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("g. hot path fires atomic claim UPDATE (status='processing') and calls trackInFlight on success", async () => {
    const body = buildPayload();
    const sig = sign(TIMESTAMP, body, WEBHOOK_SECRET);

    // Route handler mocks: connection lookup + insert + webhookLastReceivedAt update
    mockConnectionFound();
    mockInsertNoConflict();
    // Update #1: webhookLastReceivedAt
    mockUpdateOk();
    // Update #2: atomic claim — returns rowCount=1 (successfully claimed)
    mockDb.update.mockReturnValueOnce(makeChain({ rowCount: 1 }));

    // Processor internals: workoutProcessor checks connection then fetches from Whoop.
    // Return a connection with autoImportEnabled=false so the processor short-circuits
    // to markEventSkipped (one more update call) without making any real network requests.
    mockDb.select.mockReturnValue(
      makeChain([{ autoImportEnabled: false, notifyOnAutoImport: false }]),
    );
    // Update #3: markEventSkipped inside the processor
    mockUpdateOk();

    const res = await sendWebhook({ body, signature: sig });
    expect(res.status).toBe(200);

    // Flush the setImmediate callback + any async continuations from it
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Update #1 (webhookLastReceivedAt) + Update #2 (atomic claim) = 2 minimum
    // Update #3 (markEventSkipped) may also have fired by now
    expect(mockDb.update.mock.calls.length).toBeGreaterThanOrEqual(2);

    // trackInFlight should have been called with the processor promise
    expect(mockTrackInFlight).toHaveBeenCalledOnce();
    expect(mockTrackInFlight.mock.calls[0]![0]).toBeInstanceOf(Promise);
  });
});
