import assert from "node:assert/strict";
import test from "node:test";
import { createEngine, type EngineParts } from "../src/engine.js";
import { logOf, telemetryOf } from "../src/given.js";
import { bounded } from "../src/kg/read/fence.js";
import { readPreamble, storeOf } from "../src/store.js";

/** Parts that record what was closed, in order; `fail` makes the plugins' close reject. */
function parts(closed: string[], fail = false): EngineParts {
  return {
    store: {
      sql: {} as never,
      bounds: { readTimeoutMs: 1, plan: null },
      boundedRead: async () => {
        throw new Error("not read in this test");
      },
      end: async () => {
        closed.push("store");
      },
    },
    embedder: {} as never,
    plugins: {
      list: () => [],
      waiting: () => [],
      one: () => null,
      close: async () => {
        closed.push("plugins");
        if (fail) throw new Error("a reranker would not stop");
      },
    },
    host: { readableSet: {} as never },
    settings: {} as never,
  };
}

test("the engine is the parts it was given, unchanged, and nothing can be swapped after", () => {
  const given = parts([]);
  const engine = createEngine(given);
  assert.equal(engine.store, given.store);
  assert.equal(engine.plugins, given.plugins);
  assert.equal(engine.host, given.host);
  assert.throws(() => {
    (engine as { store: unknown }).store = null;
  }, TypeError);
});

test("closing an engine closes its plugins first, then ends its store", async () => {
  const closed: string[] = [];
  await createEngine(parts(closed)).close();
  assert.deepEqual(closed, ["plugins", "store"]);
});

test("a plugin that fails to close still leaves the store ended, and the failure is the caller's", async () => {
  const closed: string[] = [];
  await assert.rejects(createEngine(parts(closed, true)).close(), /a reranker would not stop/);
  assert.deepEqual(closed, ["plugins", "store"]);
});

test("a bounded read on the engine's own pool is its store's: one transaction, its bounds, one wait timed to its telemetry", async () => {
  const timed: string[] = [];
  const noop = () => {};
  // The store's own telemetry, given as a value: nothing registered in the process.
  const told = {
    count: noop,
    timing: (name: string) => timed.push(name),
    gauge: noop,
    error: noop,
  };
  const said: string[] = [];
  const trx = { savepoint: noop, unsafe: async (statements: string) => said.push(statements) };
  const pool = { begin: async (fn: (t: typeof trx) => unknown) => fn(trx) };
  const store = storeOf(pool as never, { readTimeoutMs: 5, plan: null }, told);
  const { context } = createEngine({ ...parts([]), store });
  const read = await bounded(context, async (q) => q, ["set local work_mem = '8MB'"]);
  assert.equal(read, trx);
  assert.deepEqual(said, [readPreamble(store.bounds, ["set local work_mem = '8MB'"])]);
  assert.deepEqual(timed, ["db.bounded_read_wait"]);
});

test("an engine's telemetry is the part it was given, guarded, on its reads and its writes; with none it reports nowhere", () => {
  const counted: string[] = [];
  const told = {
    count: (name: string) => counted.push(name),
    timing: () => {},
    error: () => {
      throw new Error("a broken sink");
    },
  };
  const engine = createEngine({ ...parts([]), telemetry: told });
  telemetryOf(engine.context).count("read", 1);
  telemetryOf(engine.writes).count("write", 1);
  assert.doesNotThrow(() => telemetryOf(engine.context).error("read.failed", new Error("x")));
  assert.deepEqual(counted, ["read", "write"]);
  const none = createEngine(parts([]));
  assert.doesNotThrow(() => telemetryOf(none.writes).count("nowhere", 1));
  assert.notEqual(telemetryOf(none.context), telemetryOf(engine.context));
});

test("an engine's logger is the one it was given, on its reads and its writes; with none, one of its own", () => {
  const lines: string[] = [];
  const noop = () => {};
  const logger = {
    debug: noop,
    info: noop,
    warn: (line: string) => lines.push(line),
    error: noop,
    sayOnce: (line: string) => lines.push(`once: ${line}`),
  };
  const engine = createEngine({ ...parts([]), logger });
  logOf(engine.context).sayOnce("the index is down");
  logOf(engine.writes).warn("a write went on without it");
  assert.deepEqual(lines, ["once: the index is down", "a write went on without it"]);
  // Two engines given none say a line once each: what one has said is not the other's.
  assert.notEqual(logOf(createEngine(parts([])).context), logOf(createEngine(parts([])).context));
});
