import { describe, expect, it } from "vitest";

import { netWorthHistory, type NetWorthAccount, type NetWorthSnapshot } from "./net-worth";

const checking: NetWorthAccount = { id: "chk", type: "depository" };
const brokerage: NetWorthAccount = { id: "inv", type: "investment" };
const card: NetWorthAccount = { id: "cc", type: "credit" };
const mortgage: NetWorthAccount = { id: "loan", type: "loan" };

const snap = (accountId: string, asOfDate: string, balance: number): NetWorthSnapshot => ({
  accountId,
  asOfDate,
  balance,
});

// 2026-06-01 is a Monday.
describe("netWorthHistory: liabilities", () => {
  it("flips credit and loan balances so debt lowers net worth", () => {
    const { points, current } = netWorthHistory(
      [checking, brokerage, card, mortgage],
      [
        snap("chk", "2026-06-03", 5000),
        snap("inv", "2026-06-03", 20000),
        snap("cc", "2026-06-03", 1200), // Plaid: positive = owed
        snap("loan", "2026-06-03", 15000),
      ],
    );
    expect(points).toEqual([
      { weekStart: "2026-06-01", netWorth: 8800, assets: 25000, liabilities: 16200, partial: false },
    ]);
    expect(current).toBe(8800);
  });
});

const netWorths = (r: ReturnType<typeof netWorthHistory>) =>
  r.points.map((p) => [p.weekStart, p.netWorth, p.partial]);

describe("netWorthHistory: weekly bucketing", () => {
  it("emits one point per ISO week using the last day in that week, oldest first", () => {
    const r = netWorthHistory(
      [checking],
      [
        // Out of order on purpose: input order must not matter.
        snap("chk", "2026-06-14", 1300), // Sun: last day of the week of Jun 8
        snap("chk", "2026-06-01", 1000), // Mon
        snap("chk", "2026-06-05", 1100), // Fri: last day of week of Jun 1
        snap("chk", "2026-06-08", 1200), // Mon
        snap("chk", "2026-06-15", 1400), // Mon: next week
      ],
    );
    expect(netWorths(r)).toEqual([
      ["2026-06-01", 1100, false],
      ["2026-06-08", 1300, false],
      ["2026-06-15", 1400, false],
    ]);
    expect(r.current).toBe(1400);
  });

  it("returns no points and null current with no snapshots", () => {
    expect(netWorthHistory([checking], [])).toEqual({ points: [], current: null, change30d: null });
  });
});

describe("netWorthHistory: carry-forward", () => {
  it("carries each account's last balance through weeks with no snapshot", () => {
    const r = netWorthHistory(
      [checking, card],
      [
        snap("chk", "2026-06-01", 3000),
        snap("cc", "2026-06-01", 500),
        // Week of Jun 8: nothing at all (cron missed). Week of Jun 15: card only.
        snap("cc", "2026-06-16", 800),
        snap("chk", "2026-06-24", 3500),
      ],
    );
    expect(netWorths(r)).toEqual([
      ["2026-06-01", 2500, false],
      ["2026-06-08", 2500, false], // gap week carries forward, no dip to $0
      ["2026-06-15", 2200, false], // checking carried at 3000
      ["2026-06-22", 2700, false], // card carried at 800
    ]);
  });
});

describe("netWorthHistory: change30d", () => {
  it("is current minus net worth 30 days before the latest snapshot, carried forward", () => {
    const r = netWorthHistory(
      [checking, card],
      [
        snap("chk", "2026-06-01", 4000),
        snap("cc", "2026-06-01", 1000),
        snap("chk", "2026-06-04", 4200), // in force on Jun 5 (30 days before Jul 5)
        snap("chk", "2026-06-10", 9999), // after Jun 5: not used for the baseline
        snap("chk", "2026-07-05", 5000),
        snap("cc", "2026-07-05", 300),
      ],
    );
    // Jun 5: 4200 - 1000 = 3200. Jul 5: 5000 - 300 = 4700.
    expect(r.current).toBe(4700);
    expect(r.change30d).toBe(1500);
  });

  it("is null with under 30 days of history", () => {
    const r = netWorthHistory([checking], [snap("chk", "2026-06-01", 1000), snap("chk", "2026-06-20", 1500)]);
    expect(r.change30d).toBeNull();
  });
});

describe("netWorthHistory: missing before first snapshot", () => {
  it("marks points before a newly linked account's first snapshot partial instead of counting it as $0", () => {
    const r = netWorthHistory(
      [checking, brokerage],
      [
        snap("chk", "2026-06-01", 2000),
        snap("chk", "2026-06-08", 2100),
        // Brokerage linked in week 3 with 50k already in it.
        snap("inv", "2026-06-17", 50000),
        snap("chk", "2026-06-17", 2200),
      ],
    );
    expect(r.points).toEqual([
      { weekStart: "2026-06-01", netWorth: 2000, assets: 2000, liabilities: 0, partial: true },
      { weekStart: "2026-06-08", netWorth: 2100, assets: 2100, liabilities: 0, partial: true },
      { weekStart: "2026-06-15", netWorth: 52200, assets: 52200, liabilities: 0, partial: false },
    ]);
  });

  it("leaves change30d null when 30 days ago was partial, so linking doesn't read as a gain", () => {
    const r = netWorthHistory(
      [checking, brokerage],
      [snap("chk", "2026-06-01", 2000), snap("inv", "2026-06-20", 50000), snap("chk", "2026-07-05", 2500)],
    );
    expect(r.current).toBe(52500);
    expect(r.change30d).toBeNull();
  });

  it("ignores an account that has never been snapshotted, so it doesn't mark every point partial", () => {
    // Plaid returned a null balance for the card, so it has no snapshots at all.
    const r = netWorthHistory(
      [checking, card],
      [snap("chk", "2026-06-01", 2000), snap("chk", "2026-07-05", 2500)],
    );
    expect(r.points.every((p) => !p.partial)).toBe(true);
    expect(r.current).toBe(2500);
    expect(r.change30d).toBe(500);
  });

  it("ignores snapshots of accounts that are no longer linked", () => {
    const r = netWorthHistory([checking], [snap("chk", "2026-06-01", 2000), snap("gone", "2026-06-01", 9999)]);
    expect(netWorths(r)).toEqual([["2026-06-01", 2000, false]]);
  });
});
