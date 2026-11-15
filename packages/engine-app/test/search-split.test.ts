import assert from "node:assert/strict";
import { it } from "node:test";
import type { ToolResult } from "@louvain/engine/open/mcp-protocol";
import { search } from "../src/library.js";

/**
 * What a search found, split into matches and the loosely related: by the engine when its page carries the split
 * (detected by the fields being there), and otherwise derived from the words. Each stub answers as the tool server
 * does, and records what it was asked.
 */

type Args = Record<string, unknown>;
const lease = { id: "d1", title: "lease-renewal", excerpt: "The lease renews on 1 September." };
const rig = { id: "d2", title: "calibration-rig", excerpt: "The rig slipped from June to August." };

function stub(answer: (args: Args) => ToolResult) {
  const asked: Args[] = [];
  const run = async (_name: string, args: Args) => {
    asked.push(args);
    return answer(args);
  };
  return { run, asked };
}

it("a search page with no split: is a match when a hit holds the query's words, and says so per hit", async () => {
  const { run, asked } = stub(() => ({ sources: [lease, rig], nextCursor: "c2" }));
  const page = await search(run, { query: "lease renewal", limit: 10 });
  assert.equal(page.matched, true);
  assert.deepEqual(
    page.sources.map((h) => [h.title, h.match]),
    [
      ["lease-renewal", { words: true, meaning: null }],
      ["calibration-rig", { words: false, meaning: null }],
    ],
  );
  assert.deepEqual(page.looselyRelated, []);
  assert.equal(page.next, "c2");
  assert.equal(asked.length, 1, "no keyword search when a hit already holds the words");
});

it("a search page with no split: matches nothing when no document holds the words: every hit is loosely related", async () => {
  // The keyword search finds documents by the question's small words; none holds a word that matters.
  const { run, asked } = stub((args) => ({
    sources: [rig, lease],
    ...(args.mode === "keyword" ? {} : { nextCursor: "c2" }),
  }));
  const page = await search(run, { query: "What is the zebra schedule?", limit: 10 });
  assert.equal(page.matched, false);
  assert.deepEqual(page.sources, []);
  assert.deepEqual(
    page.looselyRelated.map((h) => h.title),
    ["calibration-rig", "lease-renewal"],
  );
  assert.equal(page.note, "No document contains the words of this search.");
  assert.doesNotMatch(page.note ?? "", /zebra/, "the note never repeats the search");
  assert.equal(page.next, null, "no more results of nothing");
  assert.equal(asked[1]?.mode, "keyword");
});

const note =
  "Nothing in your documents matches this search. The nearest documents are listed under looselyRelated; they share no words with it and are not close in meaning.";

it("a search page, as the engine splits it: passes the engine's split through, and derives nothing", async () => {
  const { run, asked } = stub(() => ({
    sources: [],
    looselyRelated: [{ ...rig, match: { words: false, meaning: 0.41 } }],
    matched: false,
    note,
  }));
  const page = await search(run, { query: "zebra", limit: 10 });
  assert.deepEqual(page, {
    sources: [],
    looselyRelated: [
      {
        id: "d2",
        title: "calibration-rig",
        date: null,
        passage: rig.excerpt,
        match: { words: false, meaning: 0.41 },
      },
    ],
    matched: false,
    note,
    next: null,
  });
  assert.equal(asked.length, 1, "the keyword search is the derivation's one call");
});

it("a search page, as the engine splits it: keeps the engine's per-hit match, meaning included", async () => {
  const { run } = stub(() => ({
    sources: [{ ...rig, match: { words: false, meaning: 0.72 } }],
    looselyRelated: [],
    matched: true,
    note: null,
  }));
  const page = await search(run, { query: "when does the rig ship", limit: 10 });
  assert.deepEqual(page.sources[0]?.match, { words: false, meaning: 0.72 });
  assert.equal(page.matched, true);
});

it("a search page, as the engine splits it: an exact hit says so, and the cursor is the engine's", async () => {
  const exact = { ...lease, title: "SUP-1042", match: { words: true, meaning: 0.6, exact: true } };
  const { run } = stub(() => ({
    sources: [exact],
    looselyRelated: [],
    matched: true,
    note: null,
    nextCursor: "c2",
  }));
  const page = await search(run, { query: "SUP-1042", limit: 10 });
  assert.equal(page.sources[0]?.match.exact, true);
  assert.equal(page.next, "c2");
});

it("a search the engine refuses comes back as its sentence, not as a failure", async () => {
  const sentence = "A search needs a word or a figure to look for, and this one has neither.";
  const run = async () => {
    throw Object.assign(new Error(sentence), { name: "ToolInputError" });
  };
  const page = await search(run, { query: "?!", limit: 10 });
  assert.equal(page.refusal, sentence);
  assert.deepEqual([page.sources, page.looselyRelated, page.next], [[], [], null]);
});
