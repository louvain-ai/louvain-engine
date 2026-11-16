import assert from "node:assert/strict";
import { test } from "node:test";
import type { WithIds } from "../src/search/evidence.js";
import { fused } from "../src/search/fused.js";

const row = (id: string): WithIds =>
  ({ kind: "passage", recordId: `r-${id}`, passageId: id }) as WithIds;
const ids = (page: ReturnType<typeof fused>) => page.map((p) => p.evidence.passageId);

/** `fused` (`search/fused.ts`): a row two legs found outranks one only one found; a tie keeps the legs' order. */
test("a row found by both legs leads, and the legs that found it are named", () => {
  const page = fused([
    { leg: "keyword", rows: [row("a"), row("b")] },
    { leg: "vector", rows: [row("c"), row("b")] },
  ]);
  assert.deepEqual(ids(page), ["b", "a", "c"]);
  assert.deepEqual(page[0]?.legs, ["keyword", "vector"]);
});

test("rows of equal rank keep the order of the legs", () => {
  const page = fused([
    { leg: "keyword", rows: [row("a")] },
    { leg: "vector", rows: [row("b")] },
  ]);
  assert.deepEqual(ids(page), ["a", "b"]);
});

test("a row without a passage id is known by its record", () => {
  const bare = { kind: "passage", recordId: "r-x" } as WithIds;
  const page = fused([
    { leg: "keyword", rows: [bare] },
    { leg: "vector", rows: [bare] },
  ]);
  assert.equal(page.length, 1);
});
