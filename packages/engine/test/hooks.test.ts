import assert from "node:assert/strict";
import test from "node:test";
import { createEngine, type EngineParts } from "../src/engine.js";
import { hooksOf, type ReadHooks } from "../src/kg/read/hooks.js";
import { OPEN_KEYWORD_INDEX } from "../src/kg/read/keyword-index.js";
import { ONE_SPACE } from "../src/kg/read/space.js";
import { openExactTier } from "../src/open/source-tools/exact-seam.js";
import { unkeyedPresentation } from "../src/open/source-tools/presentation-seam.js";
import { plainReading } from "../src/reading-effective.js";
import { plainDetail } from "../src/sources/detail-seam.js";
import { noAddedFilters } from "../src/sources/filter-seam.js";

/**
 * What a build adds to a read travels in its context, and a hook it leaves out is the open build's own (`hooks.ts`).
 * An engine built with no hooks, as the open build's is, answers each read hook with the open constant itself, not a
 * copy, but for its presentation, which is the open build's made for that engine, so its cursor key is that engine's
 * and no other's; an engine built with some answers with those, and with the open build's for the rest. No process
 * binding is read.
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
    plugins: { list: () => [], waiting: () => [], one: () => null, close: async () => {} },
    host: { readableSet: {} as never },
    settings: {} as never,
    ...(hooks ? { hooks } : {}),
  };
}

const OPEN = {
  reading: plainReading,
  detail: plainDetail,
  filters: noAddedFilters,
  spaces: ONE_SPACE,
  exact: openExactTier,
} satisfies Omit<Required<ReadHooks>, "presentation" | "keyword">;

test("an engine with no hooks reads each hook as the open build's own constant", () => {
  const { context, embedder } = createEngine(parts());
  const hooks = hooksOf(context);
  // The engine's own presentation, embedder, telemetry and logger ride with them (`embedderOf`, `telemetryOf`,
  // `logOf`), and nothing a build adds.
  assert.deepEqual(Object.keys(context.hooks ?? {}).sort(), [
    "embedder",
    "keyword",
    "logger",
    "presentation",
    "telemetry",
  ]);
  assert.equal(context.hooks?.embedder, embedder);
  assert.equal(hooks.presentation.splitsRelevance, true);
  assert.deepEqual(
    Object.keys(hooks).sort(),
    [...Object.keys(OPEN), "keyword", "presentation"].sort(),
  );
  // Its keyword index is the open build's with an endpoint of its own, one its writes share.
  const { endpoint, ...index } = hooks.keyword;
  const { endpoint: door, ...open } = OPEN_KEYWORD_INDEX;
  assert.deepEqual(index, open);
  assert.notEqual(endpoint, door);
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
  assert.equal(hooks.presentation.splitsRelevance, true);
  assert.notEqual(hooks.keyword, OPEN_KEYWORD_INDEX);
  assert.equal(hooks.keyword.words, OPEN_KEYWORD_INDEX.words);
});

test("each engine seals its cursors under a key of its own, which its token makes the same after a restart", () => {
  const cursorKey = (hooks?: ReadHooks) => hooksOf(createEngine(parts(hooks)).context).presentation;
  const one = cursorKey();
  const other = cursorKey();
  assert.equal(one.cursorKey().length, 32);
  assert.equal(one.cursorKey(), one.cursorKey());
  assert.notDeepEqual(one.cursorKey(), other.cursorKey());
  const token = "a".repeat(40);
  one.keyCursorsFrom?.(token);
  other.keyCursorsFrom?.(token);
  assert.deepEqual(one.cursorKey(), other.cursorKey());
  // A build that presents its own keeps it: the engine adds no presentation over it.
  const own = { ...unkeyedPresentation, cursorKey: () => Buffer.alloc(32, 7) };
  assert.equal(cursorKey({ presentation: own }), own);
  // A read no engine made has no key to seal a cursor under, never a shared one.
  assert.throws(() => hooksOf({}).presentation.cursorKey(), /no cursor key/);
});

test("each engine's keyword index has an endpoint of its own, which its reads and its writes share", () => {
  const one = createEngine(parts());
  const other = createEngine(parts());
  assert.equal(hooksOf(one.context).keyword, hooksOf(one.writes).keyword);
  assert.notEqual(hooksOf(one.context).keyword.endpoint, hooksOf(other.context).keyword.endpoint);
  // A build that hands its own keeps it, for its reads and its writes alike.
  const keyword = { ...OPEN_KEYWORD_INDEX };
  const mine = createEngine(parts({ keyword }));
  assert.equal(hooksOf(mine.context).keyword, keyword);
  assert.equal(hooksOf(mine.writes).keyword, keyword);
});
