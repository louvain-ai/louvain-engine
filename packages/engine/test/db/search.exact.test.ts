import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";

/**
 * An identified thing outranks an unidentified reference to it, among look-alikes. The golden corpus beside eighty
 * support tickets, each a document titled by its key ("SUP-1042: …") and written alike, and two documents that cite
 * one of them. Searched for by its key, the ticket that IS it leads the page, marked `match.exact`, and the documents
 * citing it come next; a key no document is changes nothing. Without the exact tier the ticket ranks far down: the
 * embedder's nearest passages to a key are the other tickets, and fusion prefers them. The tickets and the customers
 * they name are invented.
 *
 * Its own database, so the shared golden corpus's recorded answers never see these tickets.
 */
const CUSTOMERS = ["Graniteford Energy", "Castellan Foods", "Northmere Rail", "Ashby Water"];
const ISSUES = [
  "the spare parts stock has not changed this week; the risk register entry stays amber",
  "the overnight export arrived late again and the morning report was incomplete",
  "two engineers could not sign in to the field app after the update",
  "an invoice was raised twice for the same delivery and needs a credit note",
];
const TICKETS = Array.from({ length: 80 }, (_, i) => {
  const key = `SUP-${1001 + i}`;
  const customer = CUSTOMERS[i % CUSTOMERS.length];
  const issue = ISSUES[Math.floor(i / CUSTOMERS.length) % ISSUES.length];
  return {
    key: `tickets/${key.toLowerCase()}`,
    title: `${key}: ${customer} reports a problem`,
    date: `2026-0${1 + (i % 9)}-1${i % 10}`,
    text: `${customer} reports: ${issue}. Raised by the account team and tracked in the support queue.`,
  };
});
const CITING = [
  {
    key: "tickets/escalation-3",
    title: "Escalation three",
    date: "2026-07-02",
    text: "Escalated to engineering from SUP-1042 after the second missed export; owner on call this week.",
  },
  {
    key: "tickets/incident-2026-07",
    title: "Incident report, July",
    date: "2026-07-09",
    text: "Root cause of the late exports, first reported in SUP-1042: a scheduler drift after the update.",
  },
];
/** Forty documents citing one ticket: more holders than a ranked head shows, so the walk must page past it. */
const MANY_CITE = Array.from({ length: 40 }, (_, i) => ({
  key: `notes/sup-1050-follow-up-${i + 1}`,
  title: `Follow-up ${i + 1}`,
  date: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`,
  text: `Follow-up ${i + 1} on SUP-1050: the account team called back and logged the outcome.`,
}));
const EXTRA = [...TICKETS, ...CITING, ...MANY_CITE].map((d, i) =>
  eventOf(inFolder(d.key), d, 9000 + i),
);

let engine: Engine;
before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("exact", {
    around: async (writes, loading) => {
      await loading();
      const { loadEvents } = await import("../load-events.js");
      const loaded = await loadEvents(writes, EXTRA);
      if (loaded.accepted !== EXTRA.length) throw new Error(`tickets: ${JSON.stringify(loaded)}`);
    },
  });
});
after(async () => {
  await engine?.close();
});

type Hit = { id: string; title: string; match?: { exact?: true; words?: boolean } };
type Page = { sources: Hit[]; looselyRelated?: Hit[]; matched?: boolean };
const search = async (args: Record<string, unknown>) =>
  (await engine.tool("louvain_search_sources", { limit: 10, ...args })) as Page;
const keyOf = (hit: Hit | undefined) => (hit ? engine.ids.get(hit.id) : undefined);

// Its citers next, those that match: with two words, a citer must hold both (the keyword index's matching strategy), so
// the incident that cites SUP-1042 but never says "escalation" is only loosely related.
const CITERS: Record<string, string[]> = {
  "SUP-1042": ["tickets/escalation-3", "tickets/incident-2026-07"],
  sup1042: ["tickets/escalation-3", "tickets/incident-2026-07"],
  "SUP-1042 escalation": ["tickets/escalation-3"],
};
for (const [query, citers] of Object.entries(CITERS))
  test(`the ticket a search names leads it, its citers next: ${query}`, {
    skip: skipWithoutDatabase,
  }, async () => {
    const page = await search({ query });
    assert.equal(keyOf(page.sources[0]), "tickets/sup-1042");
    assert.deepEqual(page.sources[0]?.match?.exact, true);
    assert.deepEqual(new Set(page.sources.slice(1, 1 + citers.length).map(keyOf)), new Set(citers));
    assert.equal(page.sources.slice(1).filter((h) => h.match?.exact).length, 0);
  });

test("a whole title leads its search", { skip: skipWithoutDatabase }, async () => {
  const page = await search({ query: "Incident report, July" });
  assert.equal(keyOf(page.sources[0]), "tickets/incident-2026-07");
  assert.deepEqual(page.sources[0]?.match?.exact, true);
});

test("a key no document is marks nothing exact", { skip: skipWithoutDatabase }, async () => {
  const page = await search({ query: "SUP-9999" });
  const all = [...page.sources, ...(page.looselyRelated ?? [])];
  assert.equal(all.filter((h) => h.match?.exact).length, 0);
});

test("the exact tier keeps to the search's narrowing", { skip: skipWithoutDatabase }, async () => {
  const page = await search({ query: "SUP-1042", before: "2026-01-01" });
  assert.equal(page.sources.filter((h) => keyOf(h) === "tickets/sup-1042").length, 0);
});

/** The tier is read under the reader's fence: a key whose document they cannot read puts nothing on their page. */
test("a reader is never led to a document they cannot read", {
  skip: skipWithoutDatabase,
}, async () => {
  const shown = async (reader: "staff" | "finance", query: string) => {
    const page = (await engine.search(reader, { query, limit: 10 })) as Page;
    return [...page.sources, ...(page.looselyRelated ?? [])].map(keyOf);
  };
  assert.ok(!(await shown("staff", "SUP-1042")).includes("tickets/sup-1042"));
  assert.ok(!(await shown("staff", "fin2207")).includes("finance/fin-2207"));
  assert.equal((await shown("finance", "fin2207"))[0], "finance/fin-2207");
});

test("a search within a collection is not led to a document outside it", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = (await engine.search("everyone", { query: "SUP-1042", limit: 10 }, [
    "handbook",
  ])) as Page;
  const all = [...page.sources, ...(page.looselyRelated ?? [])].map(keyOf);
  assert.ok(!all.includes("tickets/sup-1042"));
});

test("a search as of a date puts nothing in from today's exact reads", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = await search({ query: "SUP-1042", asOf: "2026-01-01" });
  assert.equal(
    [...page.sources, ...(page.looselyRelated ?? [])].filter((h) => h.match?.exact).length,
    0,
  );
});

/**
 * An identifier is one literal (`relevance.ts` `literalsOf`, `wordsOf`): its pieces are not words. The text search
 * holds "SUP-1042" as "sup-1042", "sup" and "1042", so "sup" alone had marked all eighty look-alike tickets as holding
 * the search's words; a key no ticket is, and a GUID-like key sharing a ticket's digits, match no document by words.
 */
const byWords = (page: Page) =>
  [...page.sources, ...(page.looselyRelated ?? [])].filter((h) => h.match?.words).map(keyOf);

test("a key's look-alikes do not hold its words", { skip: skipWithoutDatabase }, async () => {
  const held = byWords(await search({ query: "SUP-1042" }));
  assert.ok(held.length > 0);
  for (const key of held)
    assert.ok(
      ["tickets/sup-1042", "tickets/escalation-3", "tickets/incident-2026-07"].includes(key ?? ""),
      `${key} matched by words`,
    );
});

for (const query of ["SUP-1000", "7c2e-1042-a9f3-4b10"])
  test(`an identifier no document holds matches none by its pieces: ${query}`, {
    skip: skipWithoutDatabase,
  }, async () => {
    assert.deepEqual(byWords(await search({ query })), []);
  });

/**
 * A search that only names things is not measured by meaning (rule 6, `search-relevance.ts` `namesOnly`). To the
 * embedder one ticket key is near every other, so look-alikes followed the ticket as "loosely related". The page is
 * the ticket, then the documents citing it, then nothing; a key no document holds is the note alone.
 */
test("a key's page is the ticket and its citers, then nothing", {
  skip: skipWithoutDatabase,
}, async () => {
  const page = await search({ query: "SUP-1042" });
  assert.deepEqual(
    new Set(page.sources.map(keyOf)),
    new Set(["tickets/sup-1042", "tickets/escalation-3", "tickets/incident-2026-07"]),
  );
  assert.deepEqual(page.looselyRelated, []);
});

test("a key no document holds is the note alone", { skip: skipWithoutDatabase }, async () => {
  const page = (await search({ query: "SUP-1000" })) as Page & { note?: string | null };
  assert.deepEqual([...page.sources, ...(page.looselyRelated ?? [])], []);
  assert.match(page.note ?? "", /none holds what it names/);
});

test("walking a key cited more often than a page holds returns every holder once, and nothing else", {
  skip: skipWithoutDatabase,
}, async () => {
  const seen: (string | undefined)[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = (await search({ query: "SUP-1050", ...(cursor ? { cursor } : {}) })) as Page & {
      hasMore?: boolean;
      nextCursor?: string;
    };
    assert.deepEqual(page.looselyRelated ?? [], [], "no loosely related rows");
    seen.push(...page.sources.map(keyOf));
    cursor = page.hasMore ? page.nextCursor : undefined;
    pages++;
  } while (cursor && pages < 20);
  assert.equal(seen[0], "tickets/sup-1050", "the ticket leads");
  assert.equal(new Set(seen).size, seen.length, "each holder once");
  assert.deepEqual(
    new Set(seen),
    new Set(["tickets/sup-1050", ...MANY_CITE.map((d) => d.key)]),
    "every holder, and no look-alike",
  );
});
