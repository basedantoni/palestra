import { describe, expect, it } from "vitest";

import { buildFeedDays } from "./transaction-feed-days";

type Row = {
  id: string;
  date: string;
  amount: number;
  flow: "income" | "expense" | "transfer" | null;
  excluded: boolean;
  transferPairId: string | null;
};

const row = (id: string, date: string, amount: number, extra: Partial<Row> = {}): Row => ({
  id,
  date: `${date}T00:00:00.000Z`,
  amount,
  flow: "expense",
  excluded: false,
  transferPairId: null,
  ...extra,
});

describe("buildFeedDays", () => {
  it("groups rows by bank calendar day, newest first, keeping row order within a day", () => {
    const days = buildFeedDays([row("a", "2026-10-01", 5), row("b", "2026-10-01", 7), row("c", "2026-09-30", 3)]);

    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-09-30"]);
    expect(days[0]!.entries.map((e) => (e.kind === "txn" ? e.txn.id : "pair"))).toEqual(["a", "b"]);
  });

  it("totals each day's spend from non-excluded expenses only", () => {
    const days = buildFeedDays([
      row("a", "2026-10-01", 12.5),
      row("b", "2026-10-01", 99, { excluded: true }),
      row("c", "2026-10-01", -3200, { flow: "income" }),
      row("d", "2026-10-01", 500, { flow: "transfer" }),
      row("e", "2026-10-01", 7.25),
    ]);

    expect(days[0]!.spent).toBe(19.75);
  });

  it("collapses both legs of a matched transfer into one pair entry where the first leg appears", () => {
    const days = buildFeedDays([
      row("x", "2026-10-01", 4),
      row("in", "2026-10-01", -500, { flow: "transfer", transferPairId: "p1" }),
      row("y", "2026-10-01", 6),
      row("out", "2026-10-01", 500, { flow: "transfer", transferPairId: "p1" }),
    ]);

    const entries = days[0]!.entries;
    expect(entries.map((e) => e.kind)).toEqual(["txn", "pair", "txn"]);
    const pair = entries[1]!;
    expect(pair.kind === "pair" && [pair.out.id, pair.in.id]).toEqual(["out", "in"]);
  });

  it("shows a transfer leg alone while its other leg isn't loaded", () => {
    const days = buildFeedDays([row("out", "2026-10-01", 500, { flow: "transfer", transferPairId: "p1" })]);

    expect(days[0]!.entries).toEqual([{ kind: "txn", txn: expect.objectContaining({ id: "out" }) }]);
  });

  it("pairs legs dated on different days under the first leg's day", () => {
    const days = buildFeedDays([
      row("in", "2026-10-02", -500, { flow: "transfer", transferPairId: "p1" }),
      row("out", "2026-10-01", 500, { flow: "transfer", transferPairId: "p1" }),
    ]);

    expect(days.map((d) => d.date)).toEqual(["2026-10-02"]);
    expect(days[0]!.entries[0]!.kind).toBe("pair");
  });

  it("leaves the last day's spend unknown when more rows may follow it", () => {
    const rows = [row("a", "2026-10-01", 5), row("b", "2026-09-30", 3)];

    const partial = buildFeedDays(rows, { complete: false });
    expect(partial.map((d) => d.spent)).toEqual([5, null]);

    expect(buildFeedDays(rows, { complete: true }).map((d) => d.spent)).toEqual([5, 3]);
  });
});
