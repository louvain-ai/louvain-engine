import assert from "node:assert/strict";
import { test } from "node:test";
import type { FencedReading, RetrieverAsk } from "@louvain/engine-core";
import { figuresRetriever } from "../src/plugins/retriever-figures/index.js";
import { vectorRetriever } from "../src/plugins/retriever-vector/index.js";

/**
 * The shipped retrievers need only the contract: what they read arrives on the fenced reading, and whether recall is
 * bounded arrives on the ask. A failed read comes back empty and named by the reading, and a retriever hands that on.
 */
const ask = (query: string, bounded = false): RetrieverAsk => ({
  query,
  limit: 10,
  mode: "hybrid",
  bounded,
});

/** A reading whose every read failed, as the engine's reading returns one; it records what it was asked. */
function failedReading() {
  const asked: { digits: boolean; limit: number; mode?: string }[] = [];
  const read: FencedReading = {
    scope: { workspaceId: "org", containers: [], filters: {} },
    passages: async (_q, how) => {
      asked.push({ digits: how.digits === true, limit: how.limit, mode: how.mode });
      return { hits: [], degraded: [how.digits ? "passages:digits" : `passages:${how.mode}`] };
    },
  };
  return { read, asked };
}

test("a failed figures read reaches the search named, at half the depth", async () => {
  const { read, asked } = failedReading();
  const got = await (await figuresRetriever().create()).candidates(
    ask("how much is the budget"),
    read,
  );
  assert.deepEqual(got.degraded, ["passages:digits"]);
  assert.deepEqual(asked, [{ digits: true, limit: 5, mode: "hybrid" }]);
});

test("the figures retriever reads nothing where recall is bounded, or no figure is asked for", async () => {
  const { read, asked } = failedReading();
  const figures = await figuresRetriever().create();
  assert.deepEqual(await figures.candidates(ask("how much is the budget", true), read), {
    legs: [],
    degraded: [],
  });
  assert.deepEqual(await figures.candidates(ask("who owns the handshake"), read), {
    legs: [],
    degraded: [],
  });
  assert.equal(asked.length, 0);
});

test("the vector retriever reads by meaning alone, and nothing for a search by words alone", async () => {
  const { read, asked } = failedReading();
  const vector = await vectorRetriever().create();
  assert.deepEqual(await vector.candidates(ask("token rotation"), read), {
    legs: [{ leg: "vector", rows: [] }],
    degraded: ["passages:vector"],
  });
  assert.deepEqual(await vector.candidates({ ...ask("token rotation"), mode: "keyword" }, read), {
    legs: [],
    degraded: [],
  });
  assert.deepEqual(asked, [{ digits: false, limit: 10, mode: "vector" }]);
});
