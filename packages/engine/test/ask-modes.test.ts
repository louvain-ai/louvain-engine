import assert from "node:assert/strict";
import { test } from "node:test";
import { askSettings } from "../src/memory/modes.js";

/**
 * A mode is what a search may spend, on the request: `normal` is the deployment's environment, `fast` reads the first
 * page once with bounded recall, `thorough` reads more documents whole and hops to their neighbours. An unknown mode is
 * refused, an absent one is the caller's default — never a silent fallback to `fast`. These are the fields the engine
 * reads; an application's reader adds its own to each mode.
 */

const clear = () => {
  for (const k of [
    "LOUVAIN_READ_DOCUMENTS_MAX",
    "LOUVAIN_READ_DOCUMENTS_NEIGHBOURS",
    "LOUVAIN_DOCUMENT_CHARS",
    "LOUVAIN_ASK_DEADLINE_MS",
  ])
    delete process.env[k];
};

test("normal is the environment; fast and thorough are derived from it", () => {
  clear();
  assert.deepEqual(askSettings("normal"), {
    documents: 10,
    neighbours: 0,
    documentChars: 24000,
    // Whether a reranker runs is the caller's: it hands one in, or none (`whole-documents.ts`).
    rerank: true,
    recall: "full",
    deadlineMs: 25000,
  });
  assert.equal(askSettings("fast").neighbours, 0);
  assert.equal(askSettings("fast").rerank, false);
  const t = askSettings("thorough");
  assert.deepEqual(
    [t.documents, t.neighbours, t.deadlineMs, t.documentChars],
    [15, 3, 60000, 24000],
  );
});

test("a deployment that sets more than thorough's floor keeps it", () => {
  clear();
  process.env.LOUVAIN_READ_DOCUMENTS_MAX = "15";
  process.env.LOUVAIN_ASK_DEADLINE_MS = "90000";
  const t = askSettings("thorough");
  assert.equal(t.documents, 15);
  assert.equal(t.deadlineMs, 90000);
  assert.equal(askSettings("fast").documents, 15);
  clear();
});

test("the document size follows the mode: normal is the deployment's, thorough is floored", () => {
  clear();
  process.env.LOUVAIN_DOCUMENT_CHARS = "12000";
  assert.equal(askSettings("normal").documentChars, 12000);
  assert.equal(askSettings("thorough").documentChars, 24000);
  clear();
});

test("fast bounds recall; normal and thorough keep every leg", () => {
  clear();
  assert.equal(askSettings("fast").recall, "bounded");
  assert.equal(askSettings("normal").recall, "full");
  assert.equal(askSettings("thorough").recall, "full");
});
