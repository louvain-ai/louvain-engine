import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COUNT_CAP } from "@louvain/engine-core";
import { boundedFacets, boundedTotal, COUNT_LIMIT, WALK_LIMIT } from "../src/sources/bounds.js";
import { emptySearch } from "../src/sources/empty-search.js";
import { sourceSort } from "../src/sources/read-order.js";

test("a total past the cap is reported as the cap, flagged, never as the number seen", () => {
  assert.deepEqual(boundedTotal(0), { total: 0, totalBounded: false });
  assert.deepEqual(boundedTotal(24), { total: 24, totalBounded: false });
  assert.deepEqual(boundedTotal(SOURCE_COUNT_CAP), {
    total: SOURCE_COUNT_CAP,
    totalBounded: false,
  });
  // The count query asks for one row past the cap: that row IS the observation.
  assert.deepEqual(boundedTotal(SOURCE_COUNT_CAP + 1), {
    total: SOURCE_COUNT_CAP,
    totalBounded: true,
  });
  assert.equal(COUNT_LIMIT, SOURCE_COUNT_CAP + 1);
});

test("facets are lower bounds exactly when the walk that counted them filled the cap", () => {
  assert.equal(WALK_LIMIT, SOURCE_COUNT_CAP);
  const few = [
    { app: "gmail", count: 12 },
    { app: "slack", count: 3 },
  ];
  assert.deepEqual(boundedFacets(few), { facets: few, facetsBounded: false });
  const full = [
    { app: "gmail", count: SOURCE_COUNT_CAP - 1 },
    { app: "slack", count: 1 },
  ];
  assert.deepEqual(boundedFacets(full), { facets: full, facetsBounded: true });
  assert.deepEqual(boundedFacets([]), { facets: [], facetsBounded: false });
});

test("an empty readable set is an empty page, in the shape the page expects", () => {
  const recent = emptySearch({ q: "", offset: 48 }, sourceSort({ q: "" }));
  assert.deepEqual(recent, {
    sources: [],
    total: 0,
    facets: [],
    offset: 48,
    hasMore: false,
    retrieval: "recent",
    sort: "newest",
  });
  assert.equal(
    emptySearch({ q: "chair", offset: 0 }, sourceSort({ q: "chair" })).retrieval,
    "keyword",
  );
  assert.equal(
    emptySearch({ q: "chair", offset: 0 }, sourceSort({ q: "chair" })).sort,
    "relevance",
  );
});
