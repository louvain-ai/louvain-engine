import assert from "node:assert/strict";
import test from "node:test";
import { createEngine, type EngineParts } from "../src/engine.js";
import { bounded } from "../src/kg/read/fence.js";
import { readPreamble, storeOf } from "../src/store.js";
import { registerTelemetry } from "../src/telemetry.js";

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

test("a bounded read on the engine's own pool is its store's: one transaction, its bounds, one wait timed", async () => {
  const timed: string[] = [];
  const noop = () => {};
  registerTelemetry("engine.test", {
    count: noop,
    timing: (name) => timed.push(name),
    gauge: noop,
    error: noop,
  });
  const said: string[] = [];
  const trx = { savepoint: noop, unsafe: async (statements: string) => said.push(statements) };
  const pool = { begin: async (fn: (t: typeof trx) => unknown) => fn(trx) };
  const store = storeOf(pool as never, { readTimeoutMs: 5, plan: null });
  const { context } = createEngine({ ...parts([]), store });
  const read = await bounded(context, async (q) => q, ["set local work_mem = '8MB'"]);
  assert.equal(read, trx);
  assert.deepEqual(said, [readPreamble(store.bounds, ["set local work_mem = '8MB'"])]);
  assert.deepEqual(timed, ["db.bounded_read_wait"]);
});
