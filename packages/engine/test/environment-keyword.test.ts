import assert from "node:assert/strict";
import { test } from "node:test";
import { environment } from "../src/config/environment.js";

/**
 * The keyword index's settings, as the one environment reader parses them (`config/environment.ts`), with the
 * answers its client gave when it read `process.env` itself.
 */
test("a blank keyword index URL is none: compose writes an unset optional as an empty string", () => {
  assert.equal(environment("LOUVAIN_BM25_URL", {}), undefined);
  assert.equal(environment("LOUVAIN_BM25_URL", { LOUVAIN_BM25_URL: "" }), undefined);
  assert.equal(environment("LOUVAIN_BM25_URL", { LOUVAIN_BM25_URL: "  " }), undefined);
  assert.equal(
    environment("LOUVAIN_BM25_URL", { LOUVAIN_BM25_URL: "http://bm25:8095" }),
    "http://bm25:8095",
  );
});

test("a keyword call's timeout is 3,000 ms unless a number says otherwise", () => {
  assert.equal(environment("LOUVAIN_BM25_TIMEOUT_MS", {}), 3_000);
  assert.equal(environment("LOUVAIN_BM25_TIMEOUT_MS", { LOUVAIN_BM25_TIMEOUT_MS: "" }), 3_000);
  assert.equal(environment("LOUVAIN_BM25_TIMEOUT_MS", { LOUVAIN_BM25_TIMEOUT_MS: "soon" }), 3_000);
  assert.equal(environment("LOUVAIN_BM25_TIMEOUT_MS", { LOUVAIN_BM25_TIMEOUT_MS: "0" }), 3_000);
  assert.equal(environment("LOUVAIN_BM25_TIMEOUT_MS", { LOUVAIN_BM25_TIMEOUT_MS: "5000" }), 5_000);
});

test("a filtered keyword search is BM25's only under `on`", () => {
  assert.equal(environment("LOUVAIN_BM25_FILTERED", {}), false);
  assert.equal(environment("LOUVAIN_BM25_FILTERED", { LOUVAIN_BM25_FILTERED: " On " }), true);
  assert.equal(environment("LOUVAIN_BM25_FILTERED", { LOUVAIN_BM25_FILTERED: "yes" }), false);
});
