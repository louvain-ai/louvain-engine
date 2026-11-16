import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";

/**
 * The open page shows an excerpt as it was written (`search-relevance.ts` `asWritten`). A post-incident review in
 * Markdown is stored as passages flattened to one line for indexing; on the open page its excerpt is cut from the
 * record's own text at the passage's span, so its headings and list items keep their line breaks. A page that does not
 * split (`LOUVAIN_SEARCH_RELEVANCE=off`) keeps the flattened excerpt.
 *
 * Its own database, so the shared golden corpus's recorded answers never see this document.
 */
const REVIEW = {
  key: "reviews/overnight-export-outage",
  title: "Overnight export outage: review",
  date: "2026-07-14",
  text: [
    "# Overnight export outage",
    "",
    "Downtime: 6 hours 40 minutes.",
    "",
    "## Timeline",
    "",
    "- 02:10 the scheduler skipped the export window",
    "- 08:50 the on-call engineer restarted the export",
    "",
    "## Follow-up",
    "",
    "Action: move the scheduler's clock to UTC.",
  ].join("\n"),
};

let engine: Engine;
before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("excerpt", {
    around: async (writes, loading) => {
      await loading();
      const { loadEvents } = await import("../load-events.js");
      const loaded = await loadEvents(writes, [eventOf(inFolder(REVIEW.key), REVIEW, 9500)]);
      if (loaded.accepted !== 1) throw new Error(`review: ${JSON.stringify(loaded)}`);
    },
  });
});
after(async () => {
  await engine?.close();
});

type Page = { sources: { id: string; excerpt?: string }[] };
const excerptOfReview = async () => {
  const page = (await engine.tool("louvain_search_sources", {
    query: "export outage timeline scheduler",
    limit: 5,
  })) as Page;
  const hit = page.sources.find((h) => engine.ids.get(h.id) === REVIEW.key);
  assert.ok(hit?.excerpt, "the review is found, with an excerpt");
  return hit.excerpt;
};

test("the open page's excerpt keeps the document's line breaks", {
  skip: skipWithoutDatabase,
}, async () => {
  const excerpt = await excerptOfReview();
  assert.match(excerpt, /\n## Timeline\n/);
  assert.match(excerpt, /\n- 02:10 the scheduler/);
});

test("a page that does not split keeps the flattened excerpt", {
  skip: skipWithoutDatabase,
}, async () => {
  process.env.LOUVAIN_SEARCH_RELEVANCE = "off";
  try {
    const excerpt = await excerptOfReview();
    assert.ok(!excerpt.includes("\n"), excerpt);
    assert.match(excerpt, /## Timeline +- 02:10/);
  } finally {
    delete process.env.LOUVAIN_SEARCH_RELEVANCE;
  }
});
