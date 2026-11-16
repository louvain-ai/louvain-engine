import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Age lowers a passage's relevance inside each leg, bounded (`@louvain/engine-core` `decayed`), and only for a
 * question not about the past (the caller decides which questions decay). The sole
 * old source against fresh rows, against a real Postgres, is `recency-decay-db.test.ts`.
 */
const DAY = 86_400_000;

test("the curve: relevance times retention, bounded by the floor, unscored rows kept in place", async () => {
  const { decayed } = await import("@louvain/engine-core");
  const now = Date.parse("2026-10-28T12:00:00Z");
  const curve = { days: 30, floor: 0.7 };
  const row = (id: string, days: number, score?: number) => ({
    id,
    occurred_at: new Date(now - days * DAY),
    ...(score === undefined ? {} : { score }),
  });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  // A year old and the nearest by a third: R ≈ 0.70, 1.0 × 0.70 beats a fresh one's 0.65 × 1.0.
  assert.deepEqual(ids(decayed([row("old", 365, 0.9), row("new", 0, 0.585)], now, curve)), [
    "old",
    "new",
  ]);
  // Nearer by less than the floor allows: the fresh one wins (0.75 × 1.0 against 1.0 × 0.70).
  assert.deepEqual(ids(decayed([row("old", 365, 0.8), row("new", 0, 0.6)], now, curve)), [
    "new",
    "old",
  ]);
  // Equals: the newer leads, a month old (R = 0.7 + 0.3·e⁻¹ ≈ 0.81) behind a day old (≈ 0.99).
  assert.deepEqual(ids(decayed([row("month", 30, 0.5), row("day", 1, 0.5)], now, curve)), [
    "day",
    "month",
  ]);
  // A row with no score keeps its place; the scored ones are re-sorted around it.
  assert.deepEqual(
    ids(decayed([row("a", 300, 0.5), row("held", 100), row("b", 0, 0.5)], now, curve)),
    ["b", "held", "a"],
  );
  // No scores at all, or a floor of 1: nothing moves.
  assert.deepEqual(ids(decayed([row("x", 300), row("y", 0)], now, curve)), ["x", "y"]);
  assert.deepEqual(
    ids(decayed([row("x", 300, 0.5), row("y", 0, 0.5)], now, { days: 30, floor: 1 })),
    ["x", "y"],
  );
});
