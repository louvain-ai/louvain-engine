import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COUNT_CAP } from "@louvain/engine-core";
import { boundedFacets, boundedTotal, COUNT_LIMIT, WALK_LIMIT } from "../src/sources/bounds.js";

test("a count past the cap is reported as the cap, marked bounded", () => {
  assert.deepEqual(boundedTotal(12), { total: 12, totalBounded: false });
  assert.deepEqual(boundedTotal(SOURCE_COUNT_CAP), {
    total: SOURCE_COUNT_CAP,
    totalBounded: false,
  });
  assert.deepEqual(boundedTotal(COUNT_LIMIT), { total: SOURCE_COUNT_CAP, totalBounded: true });
  assert.equal(WALK_LIMIT, SOURCE_COUNT_CAP);
});

test("facets are lower bounds only when the walk filled the cap", () => {
  assert.equal(boundedFacets([{ count: 3 }, { count: 4 }]).facetsBounded, false);
  assert.equal(boundedFacets([{ count: SOURCE_COUNT_CAP }]).facetsBounded, true);
});
