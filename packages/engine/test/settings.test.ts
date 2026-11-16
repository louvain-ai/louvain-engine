import assert from "node:assert/strict";
import { test } from "node:test";
import { defineEngine, PluginRefused } from "@louvain/engine-core";
import { departures, settingsOf } from "../src/config/settings.js";
import { keywordRetriever } from "../src/plugins/retriever-keyword/index.js";

/**
 * The search's settings are the configuration's: `settings` in `engine.config.ts`, one schema, each setting at its default
 * when left out, a value out of range refused by its path, and the start told which settings depart from their defaults.
 */

test("no settings is every setting at today's default", () => {
  assert.deepEqual(settingsOf(undefined), {
    retrieval: { searchQuestion: true },
    rerank: { window: 30, feed: "passage", passageChars: 3_000, documentChars: 16_000, blend: 0.5 },
    server: { toolDeadlineMs: 60_000 },
  });
});

test("a setting stated is kept and its group's others keep their defaults", () => {
  const set = settingsOf(
    defineEngine({ settings: { rerank: { window: 150, blend: 1 } } }).settings,
  );
  assert.equal(set.rerank.window, 150);
  assert.equal(set.rerank.feed, "passage");
  assert.equal(set.retrieval.searchQuestion, true);
  assert.deepEqual(departures(set), [
    "rerank.window 150 (default 30)",
    "rerank.blend 1 (default 0.5)",
  ]);
});

test("a value out of range, or a setting that does not exist, stops the start by its path", () => {
  assert.throws(
    () => settingsOf({ rerank: { blend: 2 } }),
    (err: Error) => {
      assert.ok(err instanceof PluginRefused);
      assert.match(err.message, /^engine\.config\.ts settings\.rerank\.blend: /);
      return true;
    },
  );
  assert.throws(() => settingsOf({ retrieval: { searchQuestions: true } }), /settings\.retrieval/);
  assert.throws(() => settingsOf({ retrieval: { bestPassage: true } }), /settings\.retrieval/);
});

test("how a keyword hit is shown is the keyword retriever's own setting, taken when it is created", async () => {
  const asked: unknown[] = [];
  const read = {
    passages: async (_q: string, how: unknown) => {
      asked.push(how);
      return { hits: [], degraded: [] };
    },
  };
  const ask = { query: "lease", limit: 5, mode: "keyword" as const, bounded: false };
  await (await keywordRetriever().create()).candidates(ask, read);
  await (await keywordRetriever({ bestPassage: false }).create()).candidates(ask, read);
  assert.deepEqual(asked, [
    { mode: "keyword", limit: 5, bestPassage: true },
    { mode: "keyword", limit: 5, bestPassage: false },
  ]);
  assert.throws(() => keywordRetriever({ bestPassages: false } as never), /keyword/);
});
