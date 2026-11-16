import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbedder, EmbeddingsSettings } from "@louvain/embeddings";
import { EmbedderUnbound, embedderOf } from "../src/embedder.js";
import { createEngine, type EngineParts } from "../src/engine.js";
import type { EngineHooks } from "../src/writes.js";

/**
 * The engine's embedder rides on its context and its writes. `createEngine` puts its own among the hooks of each, and a
 * read or a write that embeds asks `embedderOf`: nothing binds one per process, and hooks without one embed nothing.
 */
const parts = (embedder: EngineParts["embedder"], hooks?: EngineHooks): EngineParts => ({
  store: {
    sql: {} as never,
    bounds: { readTimeoutMs: 1, plan: null },
    boundedRead: async () => {
      throw new Error("not read in this test");
    },
    end: async () => {},
  },
  embedder,
  plugins: { list: () => [], waiting: () => [], one: () => null, close: async () => {} },
  host: { readableSet: {} as never },
  settings: {} as never,
  ...(hooks ? { hooks } : {}),
});

test("hooks without an embedder embed nothing", () => {
  assert.throws(() => embedderOf({}), EmbedderUnbound);
  assert.throws(() => embedderOf({ hooks: {} }), EmbedderUnbound);
});

test("an engine's context and writes carry its own embedder, whatever its build's hooks hold", () => {
  const mine = createEmbedder(EmbeddingsSettings.parse({}));
  const open = createEngine(parts(mine));
  assert.equal(embedderOf(open.context), mine);
  assert.equal(embedderOf(open.writes), mine);
  const other = createEmbedder(EmbeddingsSettings.parse({}));
  const smuggled = { embedder: other } as EngineHooks;
  const built = createEngine(parts(mine, smuggled));
  assert.equal(embedderOf(built.context), mine, "a build cannot hand its reads another embedder");
  assert.equal(embedderOf(built.writes), mine, "nor its writes");
});
