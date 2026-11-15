import assert from "node:assert/strict";
import { test } from "node:test";
import { decayed } from "../src/decay.js";

const DAY = 86_400_000;
const now = Date.parse("2026-01-15T12:00:00Z");
const curve = { days: 30, floor: 0.7 };
const row = (id: string, ageDays: number, score?: number) => ({
  id,
  occurred_at: new Date(now - ageDays * DAY),
  ...(score === undefined ? {} : { score }),
});
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test("with equal relevance the newer row comes first", () => {
  assert.deepEqual(ids(decayed([row("old", 400, 1), row("new", 0, 1)], now, curve)), [
    "new",
    "old",
  ]);
});

test("the floor bounds what age can cost: a much nearer old row still wins", () => {
  assert.deepEqual(
    ids(decayed([row("fresh-weak", 0, 0.5), row("old-strong", 900, 1)], now, curve)),
    ["old-strong", "fresh-weak"],
  );
});

test("rows with no score hold their places, and a leg with no scores is unchanged", () => {
  const rows = [row("a", 0), row("b", 10), row("c", 20)];
  assert.deepEqual(ids(decayed(rows, now, curve)), ["a", "b", "c"]);
  const mixed = decayed([row("x", 400, 1), row("unscored", 0), row("y", 0, 1)], now, curve);
  assert.equal(mixed[1]?.id, "unscored");
  assert.deepEqual([mixed[0]?.id, mixed[2]?.id], ["y", "x"]);
});

test("the input is not changed", () => {
  const rows = [row("old", 400, 1), row("new", 0, 1)];
  decayed(rows, now, curve);
  assert.deepEqual(ids(rows), ["old", "new"]);
});
