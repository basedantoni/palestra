/**
 * Shared mocked Drizzle `db` for API tests (KOI-303).
 *
 * Results are queued per table, not per call: `onSelect(rule, rows)`
 * answers the next select *from rule*, so adding a query against
 * another table to a code path doesn't shift what every later select returns.
 * Order still matters *within* a table: successive selects from one table take
 * its queued results in call order. A table with nothing queued answers `[]`
 * (writes too: an empty `.returning()`), or its `fallback(...)` if set — so an
 * unqueued select silently returns nothing rather than failing the test. A queued result may be `rejectWith(err)`, or a
 * function of the op evaluated when awaited (e.g. echo inserted rows back).
 *
 * Every select/insert/update/delete is recorded with its table, so tests assert
 * on writes by table (`inserted`, `updated`, `deleted`, `selected` WHERE params).
 * A transaction runs its callback against the same mock.
 *
 * Wire it in with
 *   vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
 * It resets before every test (`setup.ts`), so nothing queued leaks between tests.
 * A suite's own `vi.resetAllMocks()` is safe: Vitest resets each `db` method
 * back to the implementation it was created with.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { vi } from "vitest";

type OnCall = (method: string, args: unknown[]) => void;

const REJECT = Symbol("mock-db reject");

/** A queued result that makes the awaited query reject with `error`. */
export function rejectWith(error: unknown): { [REJECT]: unknown } {
  return { [REJECT]: error };
}

function settle(result: unknown): Promise<unknown> {
  if (result !== null && typeof result === "object" && REJECT in result) {
    return Promise.reject((result as { [REJECT]: unknown })[REJECT]);
  }
  return Promise.resolve(result);
}

function chain(getResult: () => unknown, onCall?: OnCall): any {
  const proxy: any = new Proxy(
    {},
    {
      get(_, prop: string | symbol) {
        if (prop === "then") {
          return (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
            settle(getResult()).then(ok, fail);
        }
        if (prop === "catch") return (fail: (e: unknown) => unknown) => settle(getResult()).catch(fail);
        if (prop === "finally") return (fin: () => void) => settle(getResult()).finally(fin);
        return (...args: unknown[]) => {
          onCall?.(String(prop), args);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const dialect = new PgDialect();

/** The bound parameters of a WHERE clause, in order. */
export function whereParams(clause: unknown): unknown[] {
  return clause ? dialect.sqlToQuery(clause as SQL).params : [];
}

type Kind = "select" | "insert" | "update" | "delete";

export interface MockDbOp {
  kind: Kind | "query" | "execute";
  /** The Drizzle table, or the relational query name for `db.query.<name>`. */
  table: unknown;
  /** Every chained call after the op started, e.g. ["where", [clause]]. */
  calls: Array<[string, unknown[]]>;
  /** First argument of the first `method` call, e.g. arg("values"). */
  arg(method: string): unknown;
}

function newOp(kind: MockDbOp["kind"], table: unknown, calls: MockDbOp["calls"] = []): MockDbOp {
  return {
    kind,
    table,
    calls,
    arg(method) {
      return this.calls.find(([m]) => m === method)?.[1][0];
    },
  };
}

/** A queued result may be a function of the op, evaluated when awaited. */
function resolveFor(op: MockDbOp, result: unknown): unknown {
  return typeof result === "function" ? result(op) : result;
}

function createMockDb() {
  const queues = new Map<string, unknown[]>();
  const fallbacks = new Map<string, unknown>();
  const ops: MockDbOp[] = [];

  // Tables are objects; a stable per-object id keys the queues by identity.
  const tableIds = new WeakMap<object, number>();
  let nextTableId = 0;
  const key = (kind: string, table: unknown) => {
    if (typeof table === "string") return `${kind}:name:${table}`;
    let id = tableIds.get(table as object);
    if (id === undefined) tableIds.set(table as object, (id = nextTableId++));
    return `${kind}:${id}`;
  };

  const dequeue = (kind: string, table: unknown, otherwise: unknown) => {
    const k = key(kind, table);
    const queue = queues.get(k);
    if (queue && queue.length > 0) return queue.shift();
    return fallbacks.has(k) ? fallbacks.get(k) : otherwise;
  };
  const enqueue = (kind: string, table: unknown, results: unknown[]) => {
    const k = key(kind, table);
    queues.set(k, [...(queues.get(k) ?? []), ...results]);
  };

  /** insert/update/delete: the table is known up front. */
  const write = (kind: Exclude<Kind, "select">) => (table: unknown) => {
    const op = newOp(kind, table);
    ops.push(op);
    const result = dequeue(kind, table, []);
    return chain(() => resolveFor(op, result), (method, args) => op.calls.push([method, args]));
  };

  /** select: the table arrives with `.from()`, which is when its result is taken. */
  const select = (..._fields: unknown[]) => {
    const op = newOp("select", undefined);
    ops.push(op);
    let result: unknown = [];
    return chain(
      () => resolveFor(op, result),
      (method, args) => {
        op.calls.push([method, args]);
        if (method === "from") {
          op.table = args[0];
          result = dequeue("select", op.table, []);
        }
      },
    );
  };

  const execute = (statement: unknown) => {
    const op = newOp("execute", undefined, [["execute", [statement]]]);
    ops.push(op);
    return settle(resolveFor(op, dequeue("execute", "db", { rows: [] })));
  };

  const query = new Proxy(
    {},
    {
      get: (_, name: string) =>
        new Proxy(
          {},
          {
            get: (__, method: string) => (...args: unknown[]) => {
              const op = newOp("query", name, [[method, args]]);
              ops.push(op);
              return settle(resolveFor(op, dequeue(`query.${method}`, name, method === "findMany" ? [] : undefined)));
            },
          },
        ),
    },
  );

  const db: any = {
    select: vi.fn(select),
    selectDistinct: vi.fn(select),
    insert: vi.fn(write("insert")),
    update: vi.fn(write("update")),
    delete: vi.fn(write("delete")),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    execute: vi.fn(execute),
    query,
  };

  const opsOf = (kind: Kind, table: unknown) => ops.filter((o) => o.kind === kind && o.table === table);

  return {
    /** The mocked `db`. Its methods are `vi.fn`s, so call assertions still work. */
    db,
    /** Every op in call order. */
    ops,

    /** Queue results for successive selects from `table`. */
    onSelect: (table: unknown, ...results: unknown[]) => enqueue("select", table, results),
    /** Queue results for successive inserts into `table` (what `.returning()` resolves to). */
    onInsert: (table: unknown, ...results: unknown[]) => enqueue("insert", table, results),
    onUpdate: (table: unknown, ...results: unknown[]) => enqueue("update", table, results),
    onDelete: (table: unknown, ...results: unknown[]) => enqueue("delete", table, results),
    /** Queue results for `db.query.<name>.<method>(...)`, e.g. ("workout", "findFirst", row). */
    onQuery: (name: string, method: string, ...results: unknown[]) =>
      enqueue(`query.${method}`, name, results),
    /**
     * What every `kind` op on `table` answers once its queue is empty, e.g.
     * fallback("update", transaction, { rowCount: 1 }). Queued results win.
     */
    fallback: (kind: Kind, table: unknown, result: unknown) => fallbacks.set(key(kind, table), result),
    /** Queue results for successive `db.execute(...)` calls; unqueued gives `{ rows: [] }`. */
    onExecute: (...results: unknown[]) => enqueue("execute", "db", results),

    /** Rows passed to `.values()` for inserts into `table`, flattened. */
    inserted: (table: unknown): unknown[] =>
      opsOf("insert", table).flatMap((op) => {
        const values = op.arg("values");
        return Array.isArray(values) ? values : values === undefined ? [] : [values];
      }),
    /** `{ set, where }` per update of `table`; `where` is the WHERE params. */
    updated: (table: unknown) =>
      opsOf("update", table).map((op) => ({ set: op.arg("set"), where: whereParams(op.arg("where")) })),
    /** WHERE params per delete from `table`. */
    deleted: (table: unknown) => opsOf("delete", table).map((op) => whereParams(op.arg("where"))),
    /** WHERE params per select from `table`. */
    selected: (table: unknown) => opsOf("select", table).map((op) => whereParams(op.arg("where"))),
    /** Ops of one kind (any table), in call order, e.g. opsOf("insert").map((op) => op.table). */
    opsOf: (kind: MockDbOp["kind"]) => ops.filter((o) => o.kind === kind),
    /** The raw ops against `table` (optionally of one kind), for assertions the shortcuts don't cover. */
    opsOn: (table: unknown, kind?: MockDbOp["kind"]) =>
      ops.filter((o) => o.table === table && (kind === undefined || o.kind === kind)),

    reset() {
      queues.clear();
      fallbacks.clear();
      ops.length = 0;
      db.select.mockReset().mockImplementation(select);
      db.selectDistinct.mockReset().mockImplementation(select);
      db.insert.mockReset().mockImplementation(write("insert"));
      db.update.mockReset().mockImplementation(write("update"));
      db.delete.mockReset().mockImplementation(write("delete"));
      db.transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
      db.execute.mockReset().mockImplementation(execute);
    },
  };
}

/** The one mocked db every test file shares; `setup.ts` resets it before each test. */
export const mockDb = createMockDb();

/** Stand-in for the `@life-tracker/db` module. */
export const mockDbModule = { db: mockDb.db };
