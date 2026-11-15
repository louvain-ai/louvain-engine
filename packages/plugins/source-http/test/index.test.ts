import assert from "node:assert/strict";
import { test } from "node:test";
import { http } from "../src/index.js";

/**
 * The HTTP door's source: it opens only with a token of its own length, it names that token as its door, and a request
 * becomes its collection and its items, each checked where it was sent and a misspelt field said by name.
 */
test("the door needs its own token, of at least 32 characters", () => {
  assert.throws(() => http({} as never), /opens only with its own token/);
  assert.throws(() => http({ token: "short" }), /at least 32 characters/);
});

test("a request is its collection and its items, each checked where it was sent", async () => {
  const door = await http({ token: "t".repeat(32) }).create();
  assert.deepEqual(door.door, { token: "t".repeat(32) });
  assert.equal(
    door.request.safeParse({ collection: "c", items: [] }).success,
    false,
    "at least one item",
  );
  assert.equal(door.request.safeParse({ collection: "c", items: [{}], extra: 1 }).success, false);
  const request = door.request.parse({
    collection: "desk",
    items: [
      { key: "D-1", text: "Desks are booked." },
      { key: "D-2", txet: "typo" },
    ],
  });
  const listing = door.open(request, { fetch: async () => ({ ok: false, reason: "unused" }) });
  assert.deepEqual([listing.collection, listing.lists], ["desk", "some"]);
  const items = [];
  for await (const item of listing.items()) items.push(item);
  assert.deepEqual(items, [
    { key: "D-1", text: "Desks are booked." },
    { at: "item 2 (D-2)", problem: 'unknown field "txet"' },
  ]);
});
