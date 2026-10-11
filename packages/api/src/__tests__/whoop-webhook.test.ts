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
const { mockTrackInFlight } = vi.hoisted(() => ({ mockTrackInFlight: vi.fn() }));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/whoop-inflight", () => ({
  trackInFlight: mockTrackInFlight,
  getInFlightCount: vi.fn().mockReturnValue(0),
  getInFlightPromises: vi.fn().mockReturnValue([]),
}));

// v2: webhook secret is an app-level env var, not per-user DB field
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
    WHOOP_CLIENT_SECRET: "test-webhook-secret-for-hmac",
  },
}));

// Import after mocks are set up
import { whoopConnection, whoopWebhookEvent } from "@life-tracker/db/schema/index";

import { whoopWebhookApp } from "../lib/whoop-webhook";
import { mockDb } from "./helpers/mock-db";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test-webhook-secret-for-hmac";
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

function currentTimestamp(offsetMs = 0): string {
  return Math.floor((Date.now() + offsetMs) / 1000).toString();
}

async function sendWebhook(options: {
  body: string;
  signature: string;
  timestamp?: string;
}): Promise<Response> {
  const ts = options.timestamp ?? currentTimestamp();
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
  mockDb.onSelect(whoopConnection, [{ id: "conn-1", userId: APP_USER_ID, whoopUserId }]);
}

/** Nothing queued: the connection lookup finds no row. */
function mockConnectionNotFound() {}

/** insert().values().onConflictDoNothing() → one row written. */
function mockInsertNoConflict() {
  mockDb.onInsert(whoopWebhookEvent, { rowCount: 1 });
}

/** A duplicate trace_id: onConflictDoNothing writes nothing. */
function mockInsertConflict() {
  mockDb.onInsert(whoopWebhookEvent, { rowCount: 0 });
}

/** Every insert/update, whatever the table. */
const writes = () => mockDb.ops.filter((op) => op.kind === "insert" || op.kind === "update");

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("POST /webhook — Whoop webhook endpoint (v2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The async setImmediate claim on the event row loses (rowCount 0) unless a
    // test says otherwise, so tests that ignore the hot path don't run it.
    mockDb.fallback("update", whoopWebhookEvent, { rowCount: 0 });
  });

  it("a. valid HMAC signature → 200 and event row created with status processed", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    mockConnectionFound();
    mockInsertNoConflict();

    const res = await sendWebhook({ body, signature: sig, timestamp });

    expect(res.status).toBe(200);

    // One event row inserted
    expect(mockDb.inserted(whoopWebhookEvent)).toHaveLength(1);

    // One connection update (webhookLastReceivedAt)
    expect(mockDb.updated(whoopConnection)).toHaveLength(1);
  });

  it("b. invalid signature → 401, nothing written to DB", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, "wrong-secret");

    // Signature check happens before user lookup — no DB mock needed
    const res = await sendWebhook({ body, signature: sig, timestamp });

    expect(res.status).toBe(401);

    expect(writes()).toEqual([]);
  });

  it("c. unknown whoopUserId → 200 (valid sig, valid secret, no connected user)", async () => {
    const body = buildPayload(TRACE_ID, "unknown-whoop-user");
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    mockConnectionNotFound();

    // v2: return 200 to stop Whoop from retrying (user simply hasn't connected)
    const res = await sendWebhook({ body, signature: sig, timestamp });

    expect(res.status).toBe(200);

    expect(writes()).toEqual([]);
  });

  it("d. duplicate trace_id → 200, only one row (onConflictDoNothing)", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    // First delivery
    mockConnectionFound();
    mockInsertNoConflict();

    const res1 = await sendWebhook({ body, signature: sig, timestamp });
    expect(res1.status).toBe(200);

    // Second delivery (same trace_id) — simulates the DB returning rowCount: 0 due to conflict
    mockConnectionFound();
    mockInsertConflict();

    const res2 = await sendWebhook({ body, signature: sig, timestamp });
    expect(res2.status).toBe(200);

    // insert was called twice total (once per request), but the second would no-op at DB level
    expect(mockDb.inserted(whoopWebhookEvent)).toHaveLength(2);
  });

  it("e. webhookLastReceivedAt advances on successful delivery", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    mockConnectionFound();
    mockInsertNoConflict();

    const before = Date.now();
    const res = await sendWebhook({ body, signature: sig, timestamp });
    const after = Date.now();

    expect(res.status).toBe(200);

    const connectionUpdates = mockDb.updated(whoopConnection);
    expect(connectionUpdates).toHaveLength(1);
    const updatedAt = (connectionUpdates[0]!.set as Record<string, unknown>).webhookLastReceivedAt as Date;
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("missing X-WHOOP-Signature header → 401", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();

    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WHOOP-Signature-Timestamp": timestamp,
        // X-WHOOP-Signature omitted
      },
      body,
    });
    const res = await whoopWebhookApp.fetch(request);

    expect(res.status).toBe(401);
    expect(mockDb.db.insert).not.toHaveBeenCalled();
  });

  it("missing X-WHOOP-Signature-Timestamp header → 401", async () => {
    const body = buildPayload();
    const sig = sign(currentTimestamp(), body, WEBHOOK_SECRET);

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
    expect(mockDb.db.insert).not.toHaveBeenCalled();
  });

  it("g. hot path fires atomic claim UPDATE (status='processing') and calls trackInFlight on success", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    // Route handler: connection lookup + event insert (+ webhookLastReceivedAt update)
    mockConnectionFound();
    mockInsertNoConflict();
    // The atomic claim on the event row succeeds (rowCount=1)
    mockDb.onUpdate(whoopWebhookEvent, { rowCount: 1 });

    // Processor internals: workoutProcessor checks the connection then fetches from Whoop.
    // A connection with autoImportEnabled=false short-circuits it to markEventSkipped
    // (one more update) without any real network requests.
    mockDb.fallback("select", whoopConnection, [{ autoImportEnabled: false, notifyOnAutoImport: false }]);

    const res = await sendWebhook({ body, signature: sig, timestamp });
    expect(res.status).toBe(200);

    // Flush the setImmediate callback + any async continuations from it
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Update #1 (webhookLastReceivedAt) + Update #2 (atomic claim) = 2 minimum
    // Update #3 (markEventSkipped) may also have fired by now
    expect(mockDb.db.update.mock.calls.length).toBeGreaterThanOrEqual(2);

    // trackInFlight should have been called with the processor promise
    expect(mockTrackInFlight).toHaveBeenCalledOnce();
    expect(mockTrackInFlight.mock.calls[0]![0]).toBeInstanceOf(Promise);
  });

  it("h. stale timestamp with valid HMAC → 401 and no DB write", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp(-10 * 60 * 1000);
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    const res = await sendWebhook({ body, signature: sig, timestamp });

    expect(res.status).toBe(401);
    expect(mockDb.db.select).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("i. fresh timestamp with valid HMAC → 200", async () => {
    const body = buildPayload();
    const timestamp = currentTimestamp();
    const sig = sign(timestamp, body, WEBHOOK_SECRET);

    mockConnectionFound();
    mockInsertNoConflict();

    const res = await sendWebhook({ body, signature: sig, timestamp });

    expect(res.status).toBe(200);
  });
});
