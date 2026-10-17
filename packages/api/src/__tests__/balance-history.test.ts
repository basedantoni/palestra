/**
 * Daily balance charts (KOI-346): finance.netWorthHistory and
 * accounts.balanceHistory slice a chip's window ending today (the UTC
 * Balance Snapshot day, ADR 0003), and an account's history is its owner's only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { balanceSnapshot, financialAccount } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-balance-history";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } }, db: mockDb.db } as any);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finance.netWorthHistory", () => {
  it("returns one point per day of the chip's window through today, with assets and liabilities", async () => {
    mockDb.onSelect(financialAccount, [
      { id: "chk", type: "depository" },
      { id: "cc", type: "credit" },
    ]);
    mockDb.onSelect(balanceSnapshot, [
      { accountId: "chk", asOfDate: "2026-08-01", balance: 3000 },
      { accountId: "cc", asOfDate: "2026-08-01", balance: 500 },
      { accountId: "chk", asOfDate: "2026-10-01", balance: 4000 },
    ]);

    const r = await makeCaller().finance.netWorthHistory({ timeframe: "1M" });

    expect(r.points).toHaveLength(30);
    expect(r.points[0]).toEqual({
      date: "2026-09-18",
      netWorth: 2500,
      assets: 3000,
      liabilities: 500,
      partial: false,
    });
    expect(r.points.at(-1)).toMatchObject({ date: "2026-10-17", netWorth: 3500 });
    expect(r.current).toBe(3500);
    expect(r.change).toBe(1000);
    expect(mockDb.selected(balanceSnapshot)).toEqual([[USER_ID]]);
  });
});

describe("accounts.balanceHistory", () => {
  it("returns the account's daily balance and the change from the window's first point", async () => {
    mockDb.onSelect(financialAccount, [{ id: "cc", type: "credit" }]);
    mockDb.onSelect(balanceSnapshot, [
      { accountId: "cc", asOfDate: "2026-10-10", balance: 800 },
      { accountId: "cc", asOfDate: "2026-10-16", balance: 650.5 },
    ]);

    const r = await makeCaller().accounts.balanceHistory({ accountId: "cc", timeframe: "1M" });

    // A card's balance is what it owes, positive, as Plaid reports it.
    expect(r.points[0]).toMatchObject({ date: "2026-10-10", balance: 800 });
    expect(r.points.at(-1)).toMatchObject({ date: "2026-10-17", balance: 650.5 });
    expect(r.points).toHaveLength(8);
    expect(r.current).toBe(650.5);
    expect(r.change).toBe(-149.5);
  });

  it("is NOT_FOUND for an account the caller doesn't own, and reads no snapshots", async () => {
    // The owner-scoped lookup finds nothing.
    await expect(
      makeCaller().accounts.balanceHistory({ accountId: "someone-elses", timeframe: "All" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mockDb.selected(financialAccount)).toEqual([["someone-elses", USER_ID]]);
    expect(mockDb.selected(balanceSnapshot)).toEqual([]);
  });
});
