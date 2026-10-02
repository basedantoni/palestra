/**
 * Integration tests: transaction feed filters (KOI-276).
 *
 * - list scopes to the caller and applies period + account(s) + category,
 *   comparing calendar dates (Plaid dates are stored as UTC midnight)
 * - shortcut periods resolve "today" in the user's timezone
 * - summary counts matching transactions and totals expense spend with the
 *   same filters
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, makeChain } = vi.hoisted(() => {
  /** Thenable query-builder stand-in; reports any where() clause to `onWhere`. */
  function makeChain(resolveWith: unknown = [], onWhere?: (clause: unknown) => void) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "where") {
            return (clause: unknown) => {
              onWhere?.(clause);
              return proxy;
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  return { mockDb: { select: vi.fn() }, makeChain };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { appRouter } from "../routers/index";

const USER_ID = "user-txn-filters";
const ACCOUNT_A = "00000000-0000-4000-8000-00000000000a";
const ACCOUNT_B = "00000000-0000-4000-8000-00000000000b";
const CATEGORY = "00000000-0000-4000-8000-0000000000ca";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

/** Next db.select() resolves to `rows`; returns the rendered WHERE params. */
function selectReturning(rows: unknown[]): () => unknown[] {
  let where: SQL | undefined;
  mockDb.select.mockReturnValueOnce(makeChain(rows, (clause) => (where = clause as SQL)));
  return () => (where ? new PgDialect().sqlToQuery(where).params : []);
}

/** The user_preferences timezone lookup that precedes each filtered query. */
function userTimezoneIs(timezone: string | null) {
  mockDb.select.mockReturnValueOnce(makeChain(timezone ? [{ timezone }] : []));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("transactions.list filters", () => {
  it("scopes to the caller and applies month, accounts and category", async () => {
    userTimezoneIs("America/Chicago");
    const params = selectReturning([]);

    await makeCaller().transactions.list({
      period: { kind: "month", month: "2026-09" },
      accountIds: [ACCOUNT_A, ACCOUNT_B],
      categoryId: CATEGORY,
    });

    expect(params()).toEqual([
      USER_ID,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z", // exclusive: includes all of Sep 30
      ACCOUNT_A,
      ACCOUNT_B,
      CATEGORY,
    ]);
  });

  it("applies no date bounds for all time and no account filter when none chosen", async () => {
    userTimezoneIs(null);
    const params = selectReturning([]);

    await makeCaller().transactions.list({ period: { kind: "all" } });

    expect(params()).toEqual([USER_ID]);
  });

  it("resolves shortcut periods against today in the user's timezone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T03:00:00Z")); // still Sep 30 in Chicago
    userTimezoneIs("America/Chicago");
    const params = selectReturning([]);

    await makeCaller().transactions.list({ period: { kind: "preset", preset: "90d" } });

    expect(params()).toEqual([USER_ID, "2026-07-03T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  });
});

describe("transactions.summary", () => {
  it("returns the count and expense spend for the same filters", async () => {
    userTimezoneIs("America/Chicago");
    const params = selectReturning([{ count: 12, spent: 483.25 }]);

    const result = await makeCaller().transactions.summary({
      period: { kind: "month", month: "2026-09" },
      accountIds: [ACCOUNT_A],
    });

    expect(result).toEqual({ count: 12, spent: 483.25 });
    expect(params()).toEqual([
      USER_ID,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
      ACCOUNT_A,
    ]);
  });

  it("reports zero when nothing matches", async () => {
    userTimezoneIs(null);
    selectReturning([{ count: 0, spent: null }]);

    await expect(makeCaller().transactions.summary({ period: { kind: "all" } })).resolves.toEqual({
      count: 0,
      spent: 0,
    });
  });
});

const row = (id: string, day: string) => ({ id, date: new Date(`${day}T00:00:00.000Z`) });

describe("transactions.list pagination", () => {

  it("returns a page plus a cursor to the next page when more rows exist", async () => {
    userTimezoneIs(null);
    // limit 2 → the query fetches 3 to learn whether another page exists.
    selectReturning([
      row("00000000-0000-4000-8000-000000000003", "2026-10-01"),
      row("00000000-0000-4000-8000-000000000002", "2026-09-30"),
      row("00000000-0000-4000-8000-000000000001", "2026-09-29"),
    ]);

    const page = await makeCaller().transactions.list({ period: { kind: "all" }, limit: 2 });

    expect(page.items.map((t) => t.id)).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(page.nextCursor).toBe("2026-09-30T00:00:00.000Z|00000000-0000-4000-8000-000000000002");
  });

  it("has no next cursor on the last page", async () => {
    userTimezoneIs(null);
    selectReturning([row("00000000-0000-4000-8000-000000000001", "2026-09-29")]);

    const page = await makeCaller().transactions.list({ period: { kind: "all" }, limit: 2 });

    expect(page.nextCursor).toBeNull();
  });

  it("continues strictly after the cursor's (date, id)", async () => {
    userTimezoneIs(null);
    const params = selectReturning([]);

    await makeCaller().transactions.list({
      period: { kind: "all" },
      cursor: "2026-09-30T00:00:00.000Z|00000000-0000-4000-8000-000000000002",
    });

    // (date < c.date) OR (date = c.date AND id < c.id)
    expect(params()).toEqual([
      USER_ID,
      "2026-09-30T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("rejects a malformed cursor", async () => {
    await expect(
      makeCaller().transactions.list({ period: { kind: "all" }, cursor: "garbage" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
