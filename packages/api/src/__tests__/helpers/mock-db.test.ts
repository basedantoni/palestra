import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { category, categoryRule, transaction } from "@life-tracker/db/schema/index";

import { type MockDbOp, makeChain, mockDb, rejectWith } from "./mock-db";

describe("makeChain", () => {
  it("resolves its result however long the chain, reporting every call", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const chain = makeChain([{ id: 1 }], (method, args) => calls.push([method, args]));

    await expect(chain.from("t").where("w").limit(1)).resolves.toEqual([{ id: 1 }]);
    expect(calls).toEqual([
      ["from", ["t"]],
      ["where", ["w"]],
      ["limit", [1]],
    ]);
  });

  it("rejects with a rejectWith result", async () => {
    await expect(makeChain(rejectWith(new Error("boom"))).where()).rejects.toThrow("boom");
  });
});

describe("mockDb", () => {
  it("returns queued select results per table, in call order, then []", async () => {
    mockDb.onSelect(category, [{ id: "c1" }], [{ id: "c2" }]);
    mockDb.onSelect(categoryRule, [{ id: "r1" }]);

    const { db } = mockDb;
    await expect(db.select().from(category)).resolves.toEqual([{ id: "c1" }]);
    // A select against another table doesn't shift category's queue.
    await expect(db.select().from(transaction)).resolves.toEqual([]);
    await expect(db.select().from(categoryRule).where(eq(categoryRule.id, "r1"))).resolves.toEqual([
      { id: "r1" },
    ]);
    await expect(db.select().from(category)).resolves.toEqual([{ id: "c2" }]);
    await expect(db.select().from(category)).resolves.toEqual([]);
  });

  it("records each write with its table, payload and rendered WHERE params", async () => {
    const { db } = mockDb;
    await db.insert(category).values({ id: "c1", name: "Food" }).onConflictDoNothing();
    await db.update(transaction).set({ categoryId: null }).where(eq(transaction.id, "t1"));
    await db.delete(categoryRule).where(eq(categoryRule.id, "r1"));
    await db.select().from(category).where(eq(category.userId, "u1"));

    expect(mockDb.inserted(category)).toEqual([{ id: "c1", name: "Food" }]);
    expect(mockDb.updated(transaction)).toEqual([{ set: { categoryId: null }, where: ["t1"] }]);
    expect(mockDb.deleted(categoryRule)).toEqual([["r1"]]);
    expect(mockDb.selected(category)).toEqual([["u1"]]);
    expect(mockDb.inserted(transaction)).toEqual([]);
  });

  it("serves insert/update/delete results (e.g. .returning()) per table", async () => {
    mockDb.onInsert(category, [{ id: "new" }]);
    mockDb.onUpdate(transaction, rejectWith(new Error("deadlock")));

    const { db } = mockDb;
    await expect(db.insert(category).values({}).returning()).resolves.toEqual([{ id: "new" }]);
    await expect(db.update(transaction).set({}).where(eq(transaction.id, "t1"))).rejects.toThrow(
      "deadlock",
    );
  });

  it("answers with a table's fallback once its queue is empty", async () => {
    mockDb.fallback("update", transaction, { rowCount: 1 });
    mockDb.onUpdate(transaction, { rowCount: 0 });

    const { db } = mockDb;
    const update = () => db.update(transaction).set({}).where(eq(transaction.id, "t1"));
    await expect(update()).resolves.toEqual({ rowCount: 0 }); // queued first
    await expect(update()).resolves.toEqual({ rowCount: 1 });
    await expect(update()).resolves.toEqual({ rowCount: 1 });
    // Other tables keep the plain default.
    await expect(db.update(category).set({})).resolves.toEqual([]);
  });

  it("computes a queued function result from the op when awaited", async () => {
    mockDb.onInsert(category, (op: MockDbOp) =>
      (op.arg("values") as Array<{ name: string }>).map((r, i) => ({ ...r, id: `id-${i}` })),
    );

    await expect(
      mockDb.db.insert(category).values([{ name: "A" }, { name: "B" }]).returning(),
    ).resolves.toEqual([
      { name: "A", id: "id-0" },
      { name: "B", id: "id-1" },
    ]);
  });

  it("serves db.execute results in order, then { rows: [] }", async () => {
    mockDb.onExecute({ rows: [{ id: 1 }] });

    await expect(mockDb.db.execute("sql")).resolves.toEqual({ rows: [{ id: 1 }] });
    await expect(mockDb.db.execute("sql")).resolves.toEqual({ rows: [] });
  });

  it("serves relational queries by table name and method", async () => {
    mockDb.onQuery("workout", "findFirst", { id: "w1" });

    const { db } = mockDb;
    await expect(db.query.workout.findFirst({})).resolves.toEqual({ id: "w1" });
    await expect(db.query.workout.findFirst({})).resolves.toBeUndefined();
    await expect(db.query.workout.findMany({})).resolves.toEqual([]);
  });

  it("runs a transaction callback against the same mock", async () => {
    mockDb.onSelect(category, [{ id: "c1" }]);

    const result = await mockDb.db.transaction(async (tx: any) => {
      await tx.insert(category).values({ id: "c2" });
      return tx.select().from(category);
    });

    expect(result).toEqual([{ id: "c1" }]);
    expect(mockDb.inserted(category)).toEqual([{ id: "c2" }]);
  });

  it("is reset before every test", () => {
    // Previous tests queued and recorded plenty; none of it survives.
    expect(mockDb.inserted(category)).toEqual([]);
    expect(mockDb.ops).toEqual([]);
  });
});
