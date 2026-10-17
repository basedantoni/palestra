import { describe, expect, it } from "vitest";

import {
  accountBalanceHistory,
  balanceWithPending,
  carryForwardSeries,
  netWorthHistory,
  type NetWorthAccount,
  type NetWorthSnapshot,
  timeframeStart,
} from "./net-worth";

describe("timeframeStart", () => {
  it("starts 1M, 3M and 1Y at -N months +1 day, so the window is inclusive of today", () => {
    expect(timeframeStart("1M", "2026-10-17")).toBe("2026-09-18");
    expect(timeframeStart("3M", "2026-10-17")).toBe("2026-07-18");
    expect(timeframeStart("1Y", "2026-10-17")).toBe("2025-10-18");
  });

  it("clamps to the shorter month's end before adding the day", () => {
    // Mar 31 - 1 month = Feb 28 (no Feb 31), + 1 day = Mar 1.
    expect(timeframeStart("1M", "2026-03-31")).toBe("2026-03-01");
    expect(timeframeStart("1M", "2026-03-29")).toBe("2026-03-01");
    // Leap year: Mar 31 - 1 month = Feb 29.
    expect(timeframeStart("1M", "2024-03-31")).toBe("2024-03-01");
    expect(timeframeStart("1M", "2024-03-30")).toBe("2024-03-01");
    // May 31 - 3 months = Feb 28.
    expect(timeframeStart("3M", "2026-05-31")).toBe("2026-03-01");
    // Feb 29 - 1 year = Feb 28.
    expect(timeframeStart("1Y", "2028-02-29")).toBe("2027-03-01");
    // Jan 31 - 1 month crosses the year: Dec 31, + 1 day = Jan 1.
    expect(timeframeStart("1M", "2027-01-31")).toBe("2027-01-01");
  });

  it("starts YTD on Jan 1 of today's year, and All at the first snapshot (null)", () => {
    expect(timeframeStart("YTD", "2026-10-17")).toBe("2026-01-01");
    expect(timeframeStart("YTD", "2026-01-01")).toBe("2026-01-01");
    expect(timeframeStart("All", "2026-10-17")).toBeNull();
  });
});

const checking: NetWorthAccount = { id: "chk", type: "depository" };
const brokerage: NetWorthAccount = { id: "inv", type: "investment" };
const card: NetWorthAccount = { id: "cc", type: "credit" };
const mortgage: NetWorthAccount = { id: "loan", type: "loan" };

const snap = (accountId: string, asOfDate: string, balance: number): NetWorthSnapshot => ({
  accountId,
  asOfDate,
  balance,
});

const all = (to: string) => ({ from: null, to });

describe("netWorthHistory: liabilities", () => {
  it("subtracts credit and loan balances so debt lowers net worth", () => {
    const { points, current } = netWorthHistory(
      [checking, brokerage, card, mortgage],
      [
        snap("chk", "2026-06-03", 5000),
        snap("inv", "2026-06-03", 20000),
        snap("cc", "2026-06-03", 1200), // Plaid: positive = owed
        snap("loan", "2026-06-03", 15000),
      ],
      all("2026-06-03"),
    );
    expect(points).toEqual([
      { date: "2026-06-03", netWorth: 8800, assets: 25000, liabilities: 16200, partial: false },
    ]);
    expect(current).toBe(8800);
  });
});

const netWorths = (r: ReturnType<typeof netWorthHistory>) => r.points.map((p) => [p.date, p.netWorth, p.partial]);

describe("netWorthHistory: daily carry-forward", () => {
  it("emits one point per day through `to`, carrying each account's last balance over missed days", () => {
    const r = netWorthHistory(
      [checking, card],
      [
        // Out of order on purpose: input order must not matter.
        snap("cc", "2026-06-03", 800),
        snap("chk", "2026-06-01", 3000),
        snap("cc", "2026-06-01", 500),
        snap("chk", "2026-06-04", 3500),
      ],
      all("2026-06-05"),
    );
    expect(netWorths(r)).toEqual([
      ["2026-06-01", 2500, false],
      ["2026-06-02", 2500, false], // cron missed: carried, no dip to $0
      ["2026-06-03", 2200, false], // checking carried at 3000
      ["2026-06-04", 2700, false], // card carried at 800
      ["2026-06-05", 2700, false], // after the last snapshot, up to today
    ]);
    expect(r.current).toBe(2700);
  });

  it("returns no points and null current/change with no snapshots", () => {
    expect(netWorthHistory([checking], [], all("2026-06-05"))).toEqual({ points: [], current: null, change: null });
  });

  it("plots a year as one point per day, with no downsampling", () => {
    const r = netWorthHistory([checking], [snap("chk", "2025-01-01", 100)], { from: "2025-10-18", to: "2026-10-17" });
    expect(r.points).toHaveLength(365);
    expect(r.points[0]!.date).toBe("2025-10-18");
    expect(r.points.at(-1)!.date).toBe("2026-10-17");
  });
});

describe("netWorthHistory: window", () => {
  const snaps = [snap("chk", "2026-06-01", 1000), snap("chk", "2026-06-03", 1300), snap("chk", "2026-06-05", 1200)];

  it("starts at `from`, carrying in the balance from before the window", () => {
    const r = netWorthHistory([checking], snaps, { from: "2026-06-02", to: "2026-06-05" });
    expect(netWorths(r)).toEqual([
      ["2026-06-02", 1000, false],
      ["2026-06-03", 1300, false],
      ["2026-06-04", 1300, false],
      ["2026-06-05", 1200, false],
    ]);
  });

  it("starts at the first snapshot when `from` is earlier or null (All)", () => {
    const r = netWorthHistory([checking], snaps, { from: "2026-01-01", to: "2026-06-02" });
    expect(r.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(netWorthHistory([checking], snaps, all("2026-06-02")).points).toEqual(r.points);
  });

  it("has change = current minus the window's first point", () => {
    const r = netWorthHistory([checking], snaps, { from: "2026-06-02", to: "2026-06-05" });
    expect(r.change).toBe(200);
  });
});

describe("carryForwardSeries (goal balance history)", () => {
  it("carries each account's last balance forward on days only the other account was snapshotted", () => {
    const series = carryForwardSeries([
      snap("chk", "2026-06-01", 1000),
      snap("inv", "2026-06-02", 5000),
      snap("chk", "2026-06-03", 1200),
      snap("inv", "2026-06-05", 5500),
    ]);
    expect(series).toEqual([
      { asOfDate: "2026-06-01", balance: 1000 },
      { asOfDate: "2026-06-02", balance: 6000 },
      { asOfDate: "2026-06-03", balance: 6200 },
      { asOfDate: "2026-06-05", balance: 6700 },
    ]);
  });
});

describe("netWorthHistory: missing before first snapshot", () => {
  it("marks days before a newly linked account's first snapshot partial instead of counting it as $0", () => {
    const r = netWorthHistory(
      [checking, brokerage],
      [
        snap("chk", "2026-06-01", 2000),
        // Brokerage linked on day 3 with 50k already in it.
        snap("inv", "2026-06-03", 50000),
        snap("chk", "2026-06-03", 2200),
      ],
      all("2026-06-03"),
    );
    expect(r.points).toEqual([
      { date: "2026-06-01", netWorth: 2000, assets: 2000, liabilities: 0, partial: true },
      { date: "2026-06-02", netWorth: 2000, assets: 2000, liabilities: 0, partial: true },
      { date: "2026-06-03", netWorth: 52200, assets: 52200, liabilities: 0, partial: false },
    ]);
  });

  const linkedLater = [snap("chk", "2026-06-01", 2000), snap("inv", "2026-06-20", 50000), snap("chk", "2026-07-05", 2500)];

  it("measures change from the first non-partial point, so linking doesn't read as a gain", () => {
    const r = netWorthHistory([checking, brokerage], linkedLater, all("2026-07-05"));
    expect(r.points[0]!.partial).toBe(true);
    expect(r.current).toBe(52500);
    // From 52000 on 06-20, when the brokerage was linked.
    expect(r.change).toBe(500);
  });

  it("leaves change null when every point in the window is partial", () => {
    const r = netWorthHistory([checking, brokerage], linkedLater, { from: "2026-06-05", to: "2026-06-10" });
    expect(r.current).toBe(2000);
    expect(r.change).toBeNull();
  });

  it("ignores an account that has never been snapshotted, so it doesn't mark every day partial", () => {
    // Plaid returned a null balance for the card, so it has no snapshots at all.
    const r = netWorthHistory([checking, card], [snap("chk", "2026-06-01", 2000), snap("chk", "2026-06-03", 2500)], all("2026-06-03"));
    expect(r.points.every((p) => !p.partial)).toBe(true);
    expect(r.change).toBe(500);
  });

  it("ignores snapshots of accounts that are no longer linked", () => {
    const r = netWorthHistory([checking], [snap("chk", "2026-06-01", 2000), snap("gone", "2026-05-01", 9999)], all("2026-06-01"));
    expect(netWorths(r)).toEqual([["2026-06-01", 2000, false]]);
  });
});

describe("balanceWithPending", () => {
  // Plaid sign: positive = money out, negative = money in.
  it("lowers an asset by pending outflows and raises it by pending inflows", () => {
    expect(balanceWithPending("depository", 1000, 58.12)).toBe(941.88);
    expect(balanceWithPending("investment", 1000, -200)).toBe(1200);
  });

  it("raises what a credit card or loan owes by pending charges and lowers it by pending payments", () => {
    expect(balanceWithPending("credit", 878.4, 34)).toBe(912.4);
    expect(balanceWithPending("loan", 5000, -500)).toBe(4500);
  });

  it("returns the posted balance unchanged with nothing pending", () => {
    expect(balanceWithPending("depository", 1000, 0)).toBe(1000);
  });

  it("stays missing when Plaid reports no current balance", () => {
    expect(balanceWithPending("depository", null, 20)).toBeNull();
  });
});

describe("accountBalanceHistory", () => {
  it("plots a credit card's daily balance as the amount owed, with change from the window's first day", () => {
    const r = accountBalanceHistory(
      card,
      [snap("cc", "2026-06-01", 300), snap("cc", "2026-06-03", 450), snap("chk", "2026-06-02", 9999)],
      { from: "2026-06-02", to: "2026-06-04" },
    );
    expect(r.points.map((p) => [p.date, p.balance])).toEqual([
      ["2026-06-02", 300],
      ["2026-06-03", 450],
      ["2026-06-04", 450],
    ]);
    expect(r.current).toBe(450);
    expect(r.change).toBe(150);
  });

  it("returns no points and null current/change before the account's first snapshot", () => {
    expect(accountBalanceHistory(checking, [], all("2026-06-04"))).toEqual({ points: [], current: null, change: null });
  });
});
