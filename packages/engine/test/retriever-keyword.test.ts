import assert from "node:assert/strict";
import { test } from "node:test";
import type { FencedReading, RetrieverAsk } from "@louvain/engine-core";
import { keywordRetriever } from "../src/plugins/retriever-keyword/index.js";

/**
 * The keyword retriever reads the keyword leg alone, through the contract: one `keyword` read of the fenced reading,
 * at the ask's depth, its rows handed on in the index's order as the leg `keyword`.
 */
const ask: RetrieverAsk = { query: "SUP-1042 export", limit: 12, mode: "hybrid", bounded: false };

/** A stand-in index behind the reading: it answers a keyword read with its own ranked rows and records the ask. */
function standInIndex(answer: { hits: string[]; degraded: string[] }) {
  const asked: { query: string; mode: string; limit: number }[] = [];
  const read: FencedReading = {
    scope: { orgId: "org", containers: [], filters: {} },
    passages: async (query, how) => {
      asked.push({ query, mode: how.mode, limit: how.limit });
      return { hits: answer.hits.map((recordId) => ({ recordId })), degraded: answer.degraded };
    },
  };
  return { read, asked };
}

test("the keyword leg alone, at the ask's depth, its rows in the index's order", async () => {
  const { read, asked } = standInIndex({ hits: ["r2", "r1", "r3"], degraded: [] });
  const got = await (await keywordRetriever().create()).candidates(ask, read);
  assert.deepEqual(asked, [{ query: "SUP-1042 export", mode: "keyword", limit: 12 }]);
  assert.deepEqual(got, {
    legs: [{ leg: "keyword", rows: [{ recordId: "r2" }, { recordId: "r1" }, { recordId: "r3" }] }],
    degraded: [],
  });
});

test("an index that cannot answer reaches the search named, as an empty leg", async () => {
  const { read } = standInIndex({ hits: [], degraded: ["keyword:bm25"] });
  const got = await (await keywordRetriever().create()).candidates(ask, read);
  assert.deepEqual(got, { legs: [{ leg: "keyword", rows: [] }], degraded: ["keyword:bm25"] });
});
