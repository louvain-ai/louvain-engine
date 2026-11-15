import assert from "node:assert/strict";
import { test } from "node:test";
import { HNSW_EF_SEARCH, isStatementTimeout, VECTOR_LEG_SETTINGS } from "../src/kg/read/legs.js";

/**
 * The pure halves of the read's search legs: what the vector legs run
 * under and how the lexical passes are bounded. The SQL itself is proven
 * against a live database by a verification script.
 */

test("the vector legs pin the iterative scan and a raised ef_search, and nothing else", () => {
  assert.deepEqual(VECTOR_LEG_SETTINGS, [
    "set local hnsw.iterative_scan = relaxed_order",
    `set local hnsw.ef_search = ${HNSW_EF_SEARCH}`,
  ]);
  assert.ok(HNSW_EF_SEARCH >= 24, "ef_search must not be below the page it serves");
  // Every setting is `set local`: transaction-scoped, never the pool's.
  for (const s of VECTOR_LEG_SETTINGS) assert.match(s, /^set local /);
});

test("only Postgres's query_canceled is a leg timeout; any other failure is still a failure", () => {
  assert.equal(isStatementTimeout({ code: "57014" }), true);
  assert.equal(isStatementTimeout({ code: "42P01" }), false);
  assert.equal(isStatementTimeout(new Error("fetch failed")), false);
  assert.equal(isStatementTimeout(null), false);
});
