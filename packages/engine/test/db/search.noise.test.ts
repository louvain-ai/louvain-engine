import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";

/**
 * A DOCUMENT MATCHES BY MEANING ONLY WHEN THE SEARCH HAS WORDS TO MEAN SOMETHING (`search-relevance.ts`
 * `SHATTERED_AT`). A string neither the documents nor the language model know as a word has no meaning to compare:
 * the page is the note alone, with no documents under it and no further page. A real word no document holds is
 * measured, falls short, and keeps the nearest documents as loosely related. A search sharing no word with its answer
 * still finds it by meaning, and a nonsense word beside a real one leaves the real one to be measured. The stand-in
 * tokeniser (`stand-ins.ts`) splits a word of seventeen characters or more into five pieces or more.
 *
 * Its own database, so the shared golden corpus's recorded answers never see these searches.
 */
let engine: Engine;
before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("noise");
});
after(async () => {
  await engine?.close();
});

type Hit = { id: string; title: string; match?: { words: boolean; meaning: number | null } };
type Page = {
  sources: Hit[];
  looselyRelated?: Hit[];
  matched?: boolean;
  note?: string | null;
  hasMore?: boolean;
};
const search = async (query: string) =>
  (await engine.tool("louvain_search_sources", { query, limit: 5 })) as Page;

for (const query of [
  "ibobsonosoino78h9",
  "3f2b8c1e-9d4a-4e7b-a6c2-5d8e1f0b7a93",
  "qwertyuiopasdfghjkl",
  "blorptangulorpixel",
])
  test(`a search with no word to mean anything is the note alone: ${query}`, {
    skip: skipWithoutDatabase,
  }, async () => {
    const page = await search(query);
    assert.equal(page.matched, false);
    assert.deepEqual(page.sources, []);
    assert.deepEqual(page.looselyRelated, []);
    assert.equal(page.hasMore, false);
    // A string of letters and digits together is an identifier, so its page says nothing holds what it names.
    assert.match(
      page.note ?? "",
      /\d/.test(query)
        ? /none holds what it names/
        : /holds no word your documents or the language model know/,
    );
  });

test("a real word no document holds is measured, and its nearest are loosely related", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = await search("highfield");
  assert.equal(page.matched, false);
  assert.deepEqual(page.sources, []);
  assert.ok((page.looselyRelated ?? []).length > 0);
  assert.match(page.note ?? "", /only the nearest/);
});

/**
 * The leg is not killed: a search sharing no word with its answer is still measured by meaning, and a nonsense word
 * beside a real one leaves the real one measured exactly as on its own. (Whether the measure passes the floor is the
 * real embedder's, which passes most such paraphrases. The stand-in's one shared meaning stays below.)
 */
const carOf = (page: Page) =>
  [...page.sources, ...(page.looselyRelated ?? [])].find(
    (h) => h.title === "Using your own car for work",
  );

for (const query of ["automobile", "vehicle"])
  test(`a search sharing no word with its answer is still measured by meaning: ${query}`, {
    skip: skipWithoutDatabase,
  }, async () => {
    const car = carOf(await search(query));
    assert.ok(car);
    assert.equal(car.match?.words, false);
    assert.ok((car.match?.meaning ?? 0) > 0, JSON.stringify(car.match));
  });

test("a nonsense word beside a real one leaves the real one measured as on its own", {
  skip: skipWithoutDatabase,
}, async () => {
  const alone = carOf(await search("automobile"));
  const beside = carOf(await search("ibobsonosoino78h9 automobile"));
  assert.ok(alone && beside);
  assert.equal(beside.match?.meaning, alone.match?.meaning);
});
