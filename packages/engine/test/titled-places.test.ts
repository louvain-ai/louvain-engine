import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A document the search names goes on the first page (`search/titled.ts` `withTitled`): placed from the 8th place
 * (index 7) of a 24-deep head. One the legs did not rank into the head is ADDED and the head grows by one; one they
 * ranked past the first page of 10 MOVES there, keeping its own row, and the head does not grow; one already on the
 * first page stays where it is. Every other document keeps its turn.
 */
const { withTitled } = await import("../src/search/titled.js");

type Order = Parameters<typeof withTitled>[0];
const row = (id: string) => [id, { score: 1, best: { id } }] as unknown as Order[number];
const order = (ids: string[]): Order => ids.map(row);
const ids = (o: Order) => o.map(([id]) => id);
const legs = Array.from({ length: 24 }, (_, i) => `r${i}`);

test("a titled document the legs did not rank is added at the 8th place, and the head grows by one", () => {
  const placed = withTitled(order(legs), order(["named"]), 24);
  assert.equal(placed.added, 1);
  assert.equal(ids(placed.order).indexOf("named"), 7);
  assert.deepEqual(
    ids(placed.order).filter((id) => id !== "named"),
    legs,
    "every ranked document keeps its turn",
  );
});

test("one the legs ranked past the first page moves to the 8th place with its own row, and the head does not grow", () => {
  const own = order(legs);
  const placed = withTitled(own, order(["r11"]), 24);
  assert.equal(placed.added, 0);
  assert.equal(ids(placed.order).indexOf("r11"), 7);
  assert.equal(placed.order.length, 24);
  assert.equal(placed.order[7], own[11], "the legs' own row, not the title read's");
  assert.deepEqual(
    ids(placed.order).filter((id) => id !== "r11"),
    legs.filter((id) => id !== "r11"),
  );
});

test("one already on the first page stays where the legs put it", () => {
  const placed = withTitled(order(legs), order(["r3"]), 24);
  assert.equal(placed.added, 0);
  assert.deepEqual(ids(placed.order), legs);
});
