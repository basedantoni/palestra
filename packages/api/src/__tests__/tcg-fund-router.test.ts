/**
 * TCG Card Fund router (KOI-312): per-user settings (the Cards category must be
 * the caller's own) and the fund read, derived from finance budgets and
 * transactions (ADR 0005).
 *
 * Mocked db (helpers/mock-db): selects are answered per table; writes are
 * recorded so tests assert on rows written and WHERE params.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { budget, category, tcgSettings, transaction, userPreferences } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-fund";
const CARDS = "00000000-0000-4000-8000-0000000000c1";

const caller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

const spend = (date: string, amount: number) => ({
  categoryId: CARDS,
  amount,
  flow: "expense",
  excluded: false,
  date: new Date(`${date}T00:00:00Z`),
});

describe("tcg.fund.saveSettings", () => {
  it("saves the caller's Cards category and start month", async () => {
    mockDb.onSelect(category, [{ id: CARDS }]);

    await caller().tcg.fund.saveSettings({ cardsCategoryId: CARDS, startMonth: "2026-08" });

    expect(mockDb.selected(category)).toEqual([[CARDS, USER_ID]]);
    expect(mockDb.inserted(tcgSettings)).toEqual([{ userId: USER_ID, cardsCategoryId: CARDS, startMonth: "2026-08" }]);
  });

  it("rejects another user's category", async () => {
    mockDb.onSelect(category, []);

    await expect(
      caller().tcg.fund.saveSettings({ cardsCategoryId: CARDS, startMonth: "2026-08" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.inserted(tcgSettings)).toEqual([]);
  });

  it.each(["2026-13", "2026-8", "Aug 2026"])("rejects start month %s", async (startMonth) => {
    await expect(caller().tcg.fund.saveSettings({ cardsCategoryId: CARDS, startMonth })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockDb.inserted(tcgSettings)).toEqual([]);
  });
});

describe("tcg.fund.get", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Oct 1 01:00 UTC is still Sep 30 in Chicago: the current month is September.
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("has no fund before settings are saved", async () => {
    expect(await caller().tcg.fund.get()).toEqual({ settings: null, fund: null });
  });

  it("has no fund when the Cards category was deleted", async () => {
    mockDb.onSelect(tcgSettings, [{ cardsCategoryId: null, startMonth: "2026-08" }]);

    expect(await caller().tcg.fund.get()).toEqual({
      settings: { cardsCategoryId: null, startMonth: "2026-08" },
      fund: null,
    });
  });

  it("derives the fund from the Cards budgets and spend since the start month", async () => {
    mockDb.onSelect(tcgSettings, [{ cardsCategoryId: CARDS, startMonth: "2026-07" }]);
    mockDb.onSelect(userPreferences, [{ timezone: "America/Chicago" }]);
    mockDb.onSelect(budget, [
      { monthKey: "2026-07", limitAmount: 50 },
      { monthKey: "2026-09", limitAmount: 50 },
    ]);
    mockDb.onSelect(transaction, [spend("2026-07-04", 30), spend("2026-08-20", 12.5), spend("2026-09-30", 20)]);

    const result = await caller().tcg.fund.get();

    expect(result).toEqual({
      settings: { cardsCategoryId: CARDS, startMonth: "2026-07" },
      fund: {
        currentMonth: "2026-09",
        balance: 37.5,
        thisMonth: { limit: 50, spent: 20 },
        missingMonths: ["2026-08"],
      },
    });
    expect(mockDb.selected(tcgSettings)).toEqual([[USER_ID]]);
    expect(mockDb.selected(budget)[0]).toEqual(expect.arrayContaining([USER_ID, CARDS]));
    expect(mockDb.selected(transaction)[0]).toEqual(expect.arrayContaining([USER_ID, CARDS]));
  });
});
