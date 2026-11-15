import assert from "node:assert/strict";
import { test } from "node:test";
import { defineEngine, PluginRefused } from "@louvain/engine-core";
import { bindSettings, departures, settings, settingsOf } from "../src/config/settings.js";

/**
 * THE SEARCH'S SETTINGS ARE THE CONFIGURATION'S: `settings` in `engine.config.ts`, one schema, each setting at its default
 * when left out, a value out of range refused by its path, and the start told which settings depart from their defaults.
 */

test("no settings is every setting at today's default", () => {
  assert.deepEqual(settingsOf(undefined), {
    retrieval: { searchQuestion: true, bestPassage: true },
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
  assert.throws(() => settingsOf({ retrieval: { bestPassages: true } }), /settings\.retrieval/);
});

test("the settings a search reads are the ones bound, at each call", () => {
  const set = settingsOf({ retrieval: { bestPassage: false } });
  bindSettings(() => set);
  try {
    assert.equal(settings().retrieval.bestPassage, false);
  } finally {
    bindSettings(() => settingsOf(undefined));
  }
});
