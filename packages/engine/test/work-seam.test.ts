import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkHooks } from "../src/memory/work-seam.js";
import { type Writes, writeHooksOf } from "../src/writes.js";

/**
 * The indexer's work is a write hook (`writes.ts` `WriteHooks.work`). A build that hands none owns nothing: nothing to
 * check, nothing durable, and a plain transaction on the pool its writes write through. A build that hands its queue's
 * has its writes check that claim and commit through it.
 */
const pool = { begin: async (fn: (trx: unknown) => Promise<unknown>) => fn("trx") };
const writes = (work?: WorkHooks): Writes => ({
  sql: pool as never,
  hooks: work ? { work } : {},
});

test("with no work handed, a write owns nothing and commits in a plain transaction on its pool", async () => {
  const { work } = writeHooksOf(writes());
  assert.doesNotThrow(() => work.check());
  assert.equal(work.durable(), false);
  assert.equal(await work.transaction(async (trx) => trx), "trx");
});

test("a build's work is what its writes check and commit through", async () => {
  const seen: string[] = [];
  const queue: WorkHooks = {
    check: () => seen.push("check"),
    transaction: async (fn) => fn("claimed" as never),
    durable: () => true,
  };
  const { work } = writeHooksOf(writes(queue));
  assert.equal(work, queue);
  work.check();
  assert.equal(work.durable(), true);
  assert.equal(await work.transaction(async (trx) => trx), "claimed");
  assert.deepEqual(seen, ["check"]);
});
