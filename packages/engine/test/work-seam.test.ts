import assert from "node:assert/strict";
import test from "node:test";

/**
 * THE INDEXER'S WORK SEAM (`memory/work-seam.ts`): unbound it is a plain transaction on the writer's pool with nothing
 * to check and no durable owner (the open engine's case, and any process that never loaded the queue); bound, the bound
 * hooks answer; the same hooks again are a no-op and different ones are refused. This process loads no queue, so it
 * starts unbound.
 */
test("work seam: plain unbound, the bound hooks once bound, a different binding refused", async () => {
  const seam = await import("../src/memory/work-seam.js");
  assert.doesNotThrow(() => seam.checkWork());
  assert.equal(seam.durableWork(), false);
  const calls: string[] = [];
  const pool = {
    begin: async <T>(fn: (trx: never) => Promise<T>) => {
      calls.push("begin");
      return fn(undefined as never);
    },
  } as never;
  assert.equal(await seam.workTransaction(pool, async () => 6), 6);
  const hooks = {
    check: () => {
      calls.push("check");
    },
    durable: () => true,
    transaction: async <T>(fn: (trx: never) => Promise<T>) => {
      calls.push("transaction");
      return fn(undefined as never);
    },
  };
  seam.bindWork(hooks);
  seam.bindWork(hooks);
  seam.checkWork();
  assert.equal(seam.durableWork(), true);
  assert.equal(await seam.workTransaction(pool, async () => 7), 7);
  assert.deepEqual(calls, ["begin", "check", "transaction"]);
  assert.throws(() => seam.bindWork({ ...hooks }), /already bound/);
});
