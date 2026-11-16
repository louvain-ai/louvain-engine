import assert from "node:assert/strict";
import test from "node:test";
import type { ReadableSetResolver } from "@louvain/engine-core";
import { createEngine, type EngineParts } from "../src/engine.js";
import { fence, narrow } from "../src/read/fence.js";

/**
 * The fence fails closed. An org id that is not a uuid or a blank reader reads nothing, and the host is never asked;
 * an empty set or a narrowing that keeps nothing reads nothing; a host that cannot answer is an error, never an empty
 * set and never a full one. Each case is the engine's own context, made as every entry makes it (`createEngine`).
 */

const ORG = "6f1c2a3e-4b5d-4c6e-8f70-819203a4b5c6";

/** The engine over a host whose resolver answers `answer` and records whom it was asked about. */
function engineAnswering(answer: () => Promise<string[]>, admitted: string[] = []) {
  const asked: string[] = [];
  const readableSet: ReadableSetResolver = {
    readableSet: async (principal) => {
      asked.push(principal);
      return answer();
    },
    admitted: () => admitted,
  };
  const { context } = createEngine({ ...PARTS, host: { readableSet } });
  return { context, asked };
}

const PARTS: EngineParts = {
  store: {
    sql: {} as never,
    bounds: { readTimeoutMs: 1, plan: null },
    boundedRead: async () => {
      throw new Error("the fence reads no table");
    },
    end: async () => {},
  },
  embedder: {} as never,
  plugins: { list: () => [], waiting: () => [], one: () => null, close: async () => {} },
  host: { readableSet: {} as never },
  settings: {} as never,
};

test("an org id that is not a uuid reads nothing, and the host is never asked", async () => {
  const { context, asked } = engineAnswering(async () => ["handbook"]);
  for (const orgId of [
    "",
    "default",
    "not-a-uuid",
    `${ORG}0`,
    `${ORG.slice(0, -1)}`,
    "' or 1=1 --",
  ])
    assert.equal(await fence(context, { orgId, principal: "alice" }), null, orgId);
  assert.deepEqual(asked, []);
});

test("a blank reader reads nothing, and the host is never asked", async () => {
  const { context, asked } = engineAnswering(async () => ["handbook"]);
  for (const principal of ["", " ", "\t\n"])
    assert.equal(await fence(context, { orgId: ORG, principal }), null, JSON.stringify(principal));
  assert.deepEqual(asked, []);
});

test("an empty set reads nothing", async () => {
  const { context, asked } = engineAnswering(async () => []);
  assert.equal(await fence(context, { orgId: ORG, principal: "alice" }), null);
  assert.deepEqual(asked, ["alice"]);
});

test("a host that cannot answer is an error, never an empty set or a full one", async () => {
  const down = new Error("the permission store did not answer");
  const { context } = engineAnswering(() => Promise.reject(down));
  await assert.rejects(fence(context, { orgId: ORG, principal: "alice" }), down);
});

test("the set is the host's answer, sorted and distinct, asked once, under the id the projection stores", async () => {
  const { context, asked } = engineAnswering(async () => ["support", "handbook", "support"]);
  const reader = await fence(context, { orgId: ORG, principal: "alice smith" });
  assert.deepEqual(reader?.containers, ["handbook", "support"]);
  assert.equal(reader?.orgId, ORG);
  assert.deepEqual(asked, ["alice_smith"]);
});

test("a narrowing keeps only what the reader holds, drops admitted records, and one that keeps nothing reads nothing", async () => {
  const { context } = engineAnswering(async () => ["handbook", "support"], ["record-1"]);
  const viewer = { orgId: ORG, principal: "alice" };
  const whole = await fence(context, viewer);
  assert.deepEqual(whole?.admitted, ["record-1"]);
  const narrowed = await fence(context, viewer, ["support", "finance"]);
  assert.deepEqual(narrowed?.containers, ["support"]);
  assert.deepEqual(narrowed?.admitted, []);
  assert.deepEqual(narrowed?.readable, ["handbook", "support"]);
  assert.equal(await fence(context, viewer, ["finance"]), null);
  assert.equal(await fence(context, viewer, []), null);
  assert.equal(whole && narrow(whole, ["finance"]), null);
});
