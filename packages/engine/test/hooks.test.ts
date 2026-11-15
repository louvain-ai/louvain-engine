import assert from "node:assert/strict";
import test from "node:test";
import { createEngine, type EngineParts } from "../src/engine.js";
import { hooksOf, type ReadHooks } from "../src/kg/read/hooks.js";
import { OPEN_KEYWORD_INDEX } from "../src/kg/read/keyword-index.js";
import { ONE_SPACE } from "../src/kg/read/space.js";
import { openExactTier } from "../src/open/source-tools/exact-seam.js";
import { openPresentation } from "../src/open/source-tools/presentation-seam.js";
import { plainReading } from "../src/reading-effective.js";
import { plainDetail } from "../src/sources/detail-seam.js";
import { noAddedFilters } from "../src/sources/filter-seam.js";

/**
 * WHAT A BUILD ADDS TO A READ TRAVELS IN ITS CONTEXT, AND A HOOK IT LEAVES OUT IS THE OPEN BUILD'S OWN (`hooks.ts`).
 * An engine built with no hooks, as the open build's is, answers each read hook with the open constant itself, not a
 * copy, so a read that compares one (whether a page's presentation is the open build's) compares by identity; an
 * engine built with some answers with those, and with the open constants for the rest. No process binding is read.
 */
function parts(hooks?: ReadHooks): EngineParts {
  return {
    store: {
      sql: {} as never,
      bounds: { readTimeoutMs: 1, plan: null },
      boundedRead: async () => {
        throw new Error("not read in this test");
      },
      end: async () => {},
    },
    embedder: {} as never,
    plugins: { list: () => [], close: async () => {} },
    host: { readableSet: {} as never },
    settings: {} as never,
    ...(hooks ? { hooks } : {}),
  };
}

const OPEN = {
  reading: plainReading,
  detail: plainDetail,
  filters: noAddedFilters,
  presentation: openPresentation,
  keyword: OPEN_KEYWORD_INDEX,
  spaces: ONE_SPACE,
  exact: openExactTier,
} satisfies Required<ReadHooks>;

test("an engine with no hooks reads each hook as the open build's own constant", () => {
  const { context, embedder } = createEngine(parts());
  // The engine's own embedder rides with them (`embedderOf`), and nothing a build adds.
  assert.deepEqual(context.hooks, { embedder });
  const hooks = hooksOf(context);
  assert.deepEqual(Object.keys(hooks).sort(), Object.keys(OPEN).sort());
  for (const [key, open] of Object.entries(OPEN))
    assert.equal(hooks[key as keyof ReadHooks], open, key);
});

test("an engine with some hooks reads those, and the open build's for the rest", () => {
  const reading: ReadHooks["reading"] = (sql, alias) => plainReading(sql, alias);
  const spaces: ReadHooks["spaces"] = { spaceFor: async () => null, fellBack: () => {} };
  const { context } = createEngine(parts({ reading, spaces }));
  const hooks = hooksOf(context);
  assert.equal(hooks.reading, reading);
  assert.equal(hooks.spaces, spaces);
  assert.equal(hooks.detail, plainDetail);
  assert.equal(hooks.filters, noAddedFilters);
  assert.equal(hooks.presentation, openPresentation);
  assert.equal(hooks.keyword, OPEN_KEYWORD_INDEX);
});
