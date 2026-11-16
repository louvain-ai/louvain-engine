import assert from "node:assert/strict";
import { test } from "node:test";
import type { Reranked, Reranker } from "@louvain/engine-core";
import type { AskRow } from "../src/ask/evidence.js";
import { rerankedDocuments } from "../src/ask/rerank-documents.js";
import { settingsOf } from "../src/config/settings.js";

/** The default engine's reranking settings: its window, feed and blend. */
const TUNING = settingsOf(undefined).rerank;

/**
 * The reranker contract, as the search reads it: a planted reranker's scores decide the order (blended with the
 * legs' own), each scored document carries its score, and a reranker that cannot answer is a named outcome
 * (`rerank:documents`) with the legs' order kept and no score shown, never an order that pretends to be ranked.
 */
const row = (id: string): AskRow => ({
  id: `${id}#0`,
  key: `passage:${id}#0`,
  tier: "passage",
  text: `text of ${id}`,
  container: "c",
  author: null,
  relayed: false,
  occurredAt: "2026-01-01T00:00:00Z",
  score: 1,
  eventId: id,
});

const ranked = ["a", "b", "c"].map((id) => [id, { score: 1, best: row(id) }] as const);

const planted = (answer: (texts: readonly string[]) => Reranked): Reranker => ({
  model: "planted",
  rerank: async ({ texts }) => answer(texts),
});

test("a planted reranker's scores decide the order and each document carries its score", async () => {
  const reranker = planted(() => ({ ok: true, scores: [0.1, 0.99, 0.2] }));
  const got = await rerankedDocuments([...ranked], [], {
    tuning: TUNING,
    query: "q",
    reranker,
  });
  // Blended half and half with the legs' order: b, second by the legs and first by the reranker, leads.
  assert.deepEqual(
    got.order.map(([id]) => id),
    ["b", "a", "c"],
  );
  assert.deepEqual(Object.fromEntries(got.relevance ?? []), { b: 0.99, c: 0.2, a: 0.1 });
  assert.deepEqual(got.degraded, []);
});

test("a reranker that fails is named, and the legs' order stands with no score", async () => {
  for (const answer of [
    (): Reranked => ({ ok: false, failure: "the sidecar did not answer" }),
    (): Reranked => ({ ok: true, scores: [0.5] }),
    (): Reranked => ({ ok: true, scores: [0.5, 1.5, 0.2] }),
  ]) {
    const got = await rerankedDocuments([...ranked], [], {
      tuning: TUNING,
      query: "q",
      reranker: planted(answer),
    });
    assert.deepEqual(
      got.order.map(([id]) => id),
      ["a", "b", "c"],
    );
    assert.equal(got.relevance, null);
    assert.deepEqual(got.degraded, ["rerank:documents"]);
  }
});

test("with no reranker nothing is asked and nothing is scored", async () => {
  const got = await rerankedDocuments([...ranked], [], {
    tuning: TUNING,
    query: "q",
    reranker: null,
  });
  assert.deepEqual(
    got.order.map(([id]) => id),
    ["a", "b", "c"],
  );
  assert.equal(got.relevance, null);
  assert.deepEqual(got.degraded, []);
});
