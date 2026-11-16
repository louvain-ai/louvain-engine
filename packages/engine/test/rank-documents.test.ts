import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDocuments } from "../src/read/documents/page-row.js";
import type { Evidence } from "../src/search/evidence-row.js";

/**
 * A document's rank is its BEST chunk plus a share of the rest — not the sum,
 * which let a long runbook with ten weak matches outrank the one short
 * document that answers. Rows that belong to no document stay on
 * the page as they were; a pool row that is not on the page ranks documents
 * and is never promoted on its own.
 */

const row = (
  id: string,
  eventId: string | undefined,
  score: number,
  tier: Evidence["tier"] = "passage",
): Evidence => ({
  id,
  tier,
  text: id,
  container: "c",
  author: null,
  relayed: false,
  occurredAt: "2026-01-01T00:00:00Z",
  score,
  ...(eventId ? { eventId } : {}),
});

test("best chunk wins over many weak chunks at bonus 0, sum wins at bonus 1", () => {
  const page = [
    row("a1", "A", 0.1),
    row("b1", "B", 0.06),
    row("b2", "B", 0.06),
    row("b3", "B", 0.06),
  ];
  const max = rankDocuments(page, [], 0);
  assert.deepEqual(
    max.ranked.map(([id]) => id),
    ["A", "B"],
  );
  const sum = rankDocuments(page, [], 1);
  assert.deepEqual(
    sum.ranked.map(([id]) => id),
    ["B", "A"],
  );
  const between = rankDocuments(page, [], 0.25);
  assert.deepEqual(
    between.ranked.map(([id]) => id),
    ["A", "B"],
  );
  assert.equal(between.ranked[0]?.[1].best.id, "a1");
});

test("the pool ranks documents the page only partly names, and adds no loose rows", () => {
  const claim = row("k1", undefined, 0.2, "claim");
  const page = [row("a1", "A", 0.1), claim];
  const pool = [
    row("a1", "A", 0.1),
    row("c1", "C", 0.09),
    row("c2", "C", 0.08),
    row("k2", undefined, 0.5, "claim"),
  ];
  const r = rankDocuments(page, pool, 0.25);
  assert.deepEqual(
    r.ranked.map(([id]) => id),
    ["C", "A"],
  );
  assert.deepEqual(
    r.loose.map((e) => e.id),
    ["k1"],
  );
});

test("a page with no document rows ranks nothing and keeps its rows loose", () => {
  const page = [row("k1", undefined, 0.2, "claim")];
  const r = rankDocuments(page, [], 0.25);
  assert.equal(r.ranked.length, 0);
  assert.deepEqual(
    r.loose.map((e) => e.id),
    ["k1"],
  );
});

test("a memory stays itself: it is loose, never grouped into the message it paraphrases", () => {
  const memory = row("m1", "A", 0.3, "memory");
  const page = [row("a1", "A", 0.1), memory];
  const r = rankDocuments(page, [], 1);
  assert.deepEqual(
    r.ranked.map(([id, d]) => [id, d.best.id]),
    [["A", "a1"]],
  );
  assert.deepEqual(
    r.loose.map((e) => e.id),
    ["m1"],
  );
});

test("a statement never ranks a document: it stays loose, and its document ranks by its passages", () => {
  const page = [
    row("pA", "A", 0.05),
    row("sB", "B", 0.2, "claim"),
    row("pB", "B", 0.01),
    row("sX", undefined, 0.3, "claim"),
  ];
  const r = rankDocuments(page, [], 0);
  assert.deepEqual(
    r.ranked.map(([id]) => id),
    ["A", "B"],
    "B ranks by its weak passage alone",
  );
  assert.deepEqual(
    r.loose.map((e) => e.id),
    ["sB", "sX"],
  );
});
