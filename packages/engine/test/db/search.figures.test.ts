import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";

/**
 * A FIGURE IS ONE FIGURE HOWEVER IT IS WRITTEN (the keyword index's analyzer, its word-delimiter step: `analyzer-cases.json`). A price
 * list states "GBP 2,400"; nobody writes "2400". Searched as "2400", "2,400" or "2.400", it is one search and
 * one page, the same documents in the same order, the price list matching by its figure. The figure's pieces are not
 * words, so "400 units" does not match "2,400": the analyzer indexes "2,400" as `2400` too, and a search takes it
 * whole. Grouped by a space ("2 400") it is two numbers, as the word-delimiter step reads it (it joins across an
 * intra-word delimiter, never across a space). The owner's first reported search bug.
 *
 * Its own database, so the shared golden corpus's recorded answers never see these documents.
 */
const DOCS = [
  {
    key: "finance/price-list-2026",
    title: "Price list 2026",
    date: "2026-01-05",
    text: "The enterprise seat costs GBP 2,400 a year and the team seat GBP 600 a year.",
  },
  {
    key: "ops/warehouse-stock",
    title: "Warehouse stock",
    date: "2026-02-10",
    text: "The warehouse holds 400 units of the old sensor and 2 spare pumps.",
  },
  {
    key: "finance/fleet-budget",
    title: "Fleet budget",
    date: "2026-03-02",
    text: "The fleet budget for next year is 24,000 pounds, unchanged.",
  },
  {
    key: "people/holiday-calendar",
    title: "Holiday calendar",
    date: "2026-04-01",
    text: "The office closes from 24 December 2026 to 2 January.",
  },
];
DOCS.push(
  {
    key: "notes/note-05",
    title: "note-05",
    date: "2026-05-05",
    text: "Kiln schedule for the spring: two firings a week.",
  },
  {
    key: "people/expense-policy",
    title: "Expense policy",
    date: "2026-05-07",
    text: "Claims are paid monthly. Note: 5 working days of notice for an advance.",
  },
  {
    key: "wiki/field-service-scheduling-notes-5",
    title: "field-service-scheduling-notes-5",
    date: "2026-05-06",
    text: "Field visits are booked a week ahead.",
  },
);
const EXTRA = DOCS.map((d, i) => eventOf(inFolder(d.key), d, 9500 + i));

let engine: Engine;
before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("figures", {
    around: async (writes, loading) => {
      await loading();
      const { loadEvents } = await import("../load-events.js");
      const loaded = await loadEvents(writes, EXTRA);
      if (loaded.accepted !== EXTRA.length) throw new Error(`figures: ${JSON.stringify(loaded)}`);
    },
  });
});
after(async () => {
  await engine?.close();
});

type Hit = { id: string; match?: { words?: boolean } };
type Page = { sources: Hit[]; looselyRelated?: Hit[] };
const search = async (query: string) =>
  (await engine.tool("louvain_search_sources", { query, limit: 10 })) as Page;
const keysOf = (page: Page) =>
  [...page.sources, ...(page.looselyRelated ?? [])].map((h) => engine.ids.get(h.id));

test("every spelling of a figure is one search: the same documents in the same order", {
  skip: skipWithoutDatabase,
}, async () => {
  const bare = await search("2400");
  // The document stating it, as a match, and nothing else: a figure is not measured by meaning (rule 6).
  assert.deepEqual(keysOf(bare), ["finance/price-list-2026"]);
  for (const spelling of ["2,400", "2.400"])
    assert.deepEqual(keysOf(await search(spelling)), keysOf(bare), spelling);
});

test("a figure's pieces are not words: 400 units do not match 2,400", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = await search("2,400");
  assert.ok(!page.sources.some((h) => engine.ids.get(h.id) === "ops/warehouse-stock"));
});

test("a figure of five digits written bare finds it written grouped", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = await search("24000");
  assert.ok(page.sources.some((h) => engine.ids.get(h.id) === "finance/fleet-budget"));
});

/**
 * A KEY'S NUMBER IS A NUMBER, AND A KEY'S TAIL IS FOUND (the owner's cases): "note-05" is found, and leads, for
 * "NOTE5", "note5", "note-5" and "note05" (a digit part loses its leading zeros), and "notes-5" finds the key that ends
 * with it (a search's key matches as the phrase of its parts).
 */
for (const query of ["NOTE5", "note5", "note-5", "note05", "note-05"])
  test(`a key's number is a number: ${query} leads with the document named note-05`, {
    skip: skipWithoutDatabase,
  }, async () => {
    // The document the search NAMES leads (the exact tier compares the key's normal form, `key-form.ts`), however
    // either is spelled; a longer key that only ends like it follows.
    assert.equal(keysOf(await search(query))[0], "notes/note-05", query);
  });

test("a key is no search for prose that says its parts: NOTE5 lists only what holds it", {
  skip: skipWithoutDatabase,
}, async () => {
  // A search that only names a thing lists its holders (rule 6); prose saying "Note: 5" holds no key note5.
  for (const query of ["NOTE5", "note-5"])
    assert.ok(!keysOf(await search(query)).includes("people/expense-policy"), query);
});

test("a search's key finds the longer key that ends with it: notes-5", {
  skip: skipWithoutDatabase,
}, async () => {
  assert.ok(keysOf(await search("notes-5")).includes("wiki/field-service-scheduling-notes-5"));
});
