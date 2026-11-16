import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";
import { keywordIndexForTests, noKeywordIndex } from "./keyword-index.js";

/**
 * Words no readable document holds (`search-unheld.ts`): searched as a prefix (the last word) or a typo of held words by
 * the keyword index's own tiers, or left out, and the page names each word. The golden corpus beside a few
 * documents of its own, all invented, read through the real keyword index (`apps/nlp/bm25.py`), started as every
 * database test starts one (`keyword-index.ts`): a container of `LOUVAIN_TEST_BM25_IMAGE`, else a Python with its binding.
 *
 * Its own database, so the shared golden corpus's recorded answers never see these documents.
 */
const DOCUMENTS = [
  {
    key: "support/marwick-renewal",
    title: "Renewal signed",
    date: "2026-03-02",
    text: "Dana Marwick signed the Larchmont renewal on Tuesday after the pricing call.",
  },
  {
    key: "support/marwick-runbook",
    title: "Runbook request",
    date: "2026-03-09",
    text: "Marwick asked for the outage runbook before the audit week.",
  },
  {
    key: "support/forecast-review",
    title: "Forecast review",
    date: "2026-03-12",
    text: "Kessler Brandt and Rhea Brandy reviewed the quarterly forecast together.",
  },
  {
    key: "board/acquisition",
    title: "Acquisition",
    date: "2026-03-15",
    text: "The Quillfeather acquisition stays confidential until the board signs.",
  },
];
const EXTRA = DOCUMENTS.map((d, i) => eventOf(inFolder(d.key), d, 9500 + i));

const skip = skipWithoutDatabase || noKeywordIndex() || false;

let engine: Engine;
let index: { url: string; stop: () => void } | undefined;
before(async () => {
  if (skip) return;
  const started = await keywordIndexForTests();
  if (typeof started === "string") throw new Error(started);
  index = started;
  const url = index.url;
  engine = await openEngine("near", {
    prepare: () => {
      process.env.LOUVAIN_BM25_URL = url;
    },
    around: async (writes, loading) => {
      await loading();
      const { loadEvents } = await import("../load-events.js");
      const loaded = await loadEvents(writes, EXTRA);
      if (loaded.accepted !== EXTRA.length) throw new Error(`near: ${JSON.stringify(loaded)}`);
    },
  });
});
after(async () => {
  await engine?.close();
  index?.stop();
});

type Hit = { id: string; match?: { words?: boolean } };
type Correction = { from: string; completed?: true; dropped?: true };
type Page = { sources: Hit[]; note?: string | null; corrected?: Correction[] };
const search = async (query: string, reader: "everyone" | "staff" = "staff") =>
  (await engine.search(reader, { query, limit: 10 })) as Page;
const keys = (page: Page) => page.sources.map((h) => engine.ids.get(h.id)?.split("@")[0]);

test("a surname typed short as the last word finds the documents holding it, and says so", {
  skip,
}, async () => {
  const page = await search("marwic");
  assert.deepEqual(page.corrected, [{ from: "marwic", completed: true }]);
  assert.match(page.note ?? "", /^No document holds "marwic"; searched for what begins with it\./);
  const found = keys(page);
  assert.ok(
    found.includes("support/marwick-renewal") && found.includes("support/marwick-runbook"),
    `${found}`,
  );
  for (const hit of page.sources.slice(0, 2)) assert.equal(hit.match?.words, true);
});

test("an unfinished last word inside a sentence is found past the sentence's stop words", {
  skip,
}, async () => {
  // "what", "did", "the" and "about" are stop words (Snowball English) and never named; "say" is a word no document
  // here holds, so it is searched without, and the page names it.
  const page = await search("what did the team say about marwic");
  assert.deepEqual(page.corrected, [
    { from: "marwic", completed: true },
    { from: "say", dropped: true },
  ]);
});

test("a transposition is one typo, and the page names the word, never what it matched", {
  skip,
}, async () => {
  const page = await search("Marwikc runbook");
  assert.deepEqual(page.corrected, [{ from: "Marwikc" }]);
  assert.match(page.note ?? "", /^No document holds "Marwikc"; searched for words like it\./);
  assert.equal(keys(page)[0], "support/marwick-runbook");
});

test("only the search's last word completes as a prefix; another is a typo or left out", {
  skip,
}, async () => {
  assert.deepEqual((await search("renewal larchm")).corrected, [
    { from: "larchm", completed: true },
  ]);
  const first = await search("larchm renewal");
  assert.deepEqual(first.corrected, [{ from: "larchm", dropped: true }]);
  assert.match(first.note ?? "", /^No document holds "larchm"; searched without it\./);
});

test("a typo in the first letter is a typo like any other", { skip }, async () => {
  assert.deepEqual((await search("narwick")).corrected, [{ from: "narwick" }]);
});

test("a word a typo from two held words finds both", { skip }, async () => {
  const page = await search("brandx");
  assert.deepEqual(page.corrected, [{ from: "brandx" }]);
  assert.ok(keys(page).includes("support/forecast-review"));
});

test("a word near nothing is searched without, and nothing matches", { skip }, async () => {
  const page = await search("zyxwvutq");
  assert.deepEqual(page.corrected, [{ from: "zyxwvutq", dropped: true }]);
  assert.match(
    page.note ?? "",
    /searched without it\. Nothing in your documents matches this search/,
  );
});

test("an identifier one digit off is never edited into another", { skip }, async () => {
  const page = await search("FIN-2208");
  assert.deepEqual(page.corrected, [{ from: "FIN-2208", dropped: true }]);
});

test("a word held only by a document the reader cannot read is never a correction", {
  skip,
}, async () => {
  assert.deepEqual((await search("quilfeather", "staff")).corrected, [
    { from: "quilfeather", dropped: true },
  ]);
  assert.deepEqual((await search("quilfeather", "everyone")).corrected, [{ from: "quilfeather" }]);
});
