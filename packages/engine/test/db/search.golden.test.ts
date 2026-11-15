import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CORPUS, READERS } from "./corpus.js";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { normalise, readGolden, writeGolden, writing } from "./golden.js";
import { CASES } from "./search.cases.js";

/**
 * WHAT THE ENGINE ANSWERS, PINNED. Every case in `search.cases.ts` runs against the golden corpus on a database built
 * from the baseline schema, and its answer must equal the one recorded in `search.golden.json`: the same documents,
 * in the same order, with the same fields, the same paging and the same degradations. A refactor that changes none of
 * these passes; one that changes any of them fails, naming the case and showing the difference.
 *
 * Beside the recording, the rules that hold whatever is recorded: a reader is never shown a document from a
 * collection they cannot read, nor its title, nor a word only it holds; a hidden document and one that does not exist
 * open the same way; and paging never shows a document twice.
 *
 *   pnpm --filter @louvain/engine test:db          # compare (needs TEST_AUTH_DATABASE_URL)
 *   pnpm --filter @louvain/engine test:db:record   # record the answers and statements as they are, and say what moved
 */
const GOLDEN = new URL("./search.golden.json", import.meta.url);
const recorded = readGolden(GOLDEN);
const answers: Record<string, unknown> = {};
let engine: Engine;

before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("golden");
});
after(async () => {
  if (writing && !skipWithoutDatabase)
    for (const line of writeGolden(GOLDEN, recorded, answers)) console.log(line);
  await engine?.close();
});

for (const c of CASES)
  test(c.name, { skip: skipWithoutDatabase }, async (t) => {
    answers[c.name] = normalise(await c.run(engine), engine.ids);
    if (c.defect) t.diagnostic(`records a known defect: ${c.defect}`);
    if (!writing) assert.deepEqual(answers[c.name], recorded[c.name]);
  });

/** What the recorded defect will be once fixed: a reader is shown a revised document as it is now. */
test("a superseded revision is never a ranked hit", {
  skip: skipWithoutDatabase,
  todo: "a known defect, recorded by the case named in SUPERSEDED_SHOWN (search.cases.ts)",
}, () => {
  const page = answers["a revised document's earlier words alone"] as {
    sources: { id: string; modifiedAt: string }[];
  };
  const hit = page.sources.find((s) => s.id === "@handbook/remote-working");
  assert.equal(hit?.modifiedAt, "2025-09-01T09:00:00.000Z");
});

/** What the rewritten search must win back: a fact deep in a long document, asked in other words, in the first ten. */
test("a fact deep in a long document is in the first ten", {
  skip: skipWithoutDatabase,
  todo: "a known cost of ranking by the best passage, recorded by DEEP_FACT_LOST (search.deep.cases.ts)",
}, () => {
  const page = answers["a fact deep in a long document, in other words"] as {
    sources: { id: string }[];
  };
  assert.ok(page.sources.some((s) => s.id === "@handbook/code-of-conduct"));
});

/** What both keyword paths must win back: an identifier found however it is written. */
/** A key typed joined is the key: the document titled by it leads, marked exact (`search-exact.ts`). */
test("an identifier typed joined finds the documents that write it hyphenated", {
  skip: skipWithoutDatabase,
}, () => {
  const page = answers["an identifier typed joined"] as {
    sources: { id: string; match?: { exact?: true } }[];
  };
  assert.equal(page.sources[0]?.id, "@finance/fin-2207");
  assert.equal(page.sources[0]?.match?.exact, true);
});

/**
 * A PAGE THAT SAYS MORE IS FOLLOWED BY ONE THAT SHOWS IT: paged until `hasMore` is false, no page before the last is
 * empty, the last says it is the last, and no document is shown twice (the app's "plan" came back empty on page 2).
 */
test("a ranked search pages to its end with no empty page", { skip: skipWithoutDatabase }, () => {
  for (const name of ["the ranked view, every page", "a matched search paged to its end"]) {
    const pages = answers[name] as {
      sources: { id: string }[];
      looselyRelated?: { id: string }[];
      hasMore: boolean;
    }[];
    const shown = pages.map((p) => [...p.sources, ...(p.looselyRelated ?? [])].map((s) => s.id));
    for (const [at, ids] of shown.entries())
      assert.ok(ids.length > 0, `${name}: page ${at + 1} is empty`);
    assert.equal(pages.at(-1)?.hasMore, false, `${name}: the last page says it is the last`);
    const all = shown.flat();
    assert.equal(new Set(all).size, all.length, `${name}: a document shown twice`);
  }
});

/** A search that matched says so on every page, however far it is paged: the split is the head's, not the page's. */
test("every page of a search that matched says it matched", { skip: skipWithoutDatabase }, () => {
  const pages = answers["the ranked view, every page"] as { matched?: boolean }[];
  assert.ok(pages.length > 1, "the case pages past its first page");
  for (const [at, page] of pages.entries()) assert.equal(page.matched, true, `page ${at + 1}`);
});

/** A figure is found whatever separators the search writes it with (FIGURE_SPLIT, search.cases.ts). */
test("a figure written another way finds the document that states it", {
  skip: skipWithoutDatabase,
}, () => {
  const page = answers["a figure written another way"] as { sources: { id: string }[] };
  assert.ok(page.sources.some((s) => s.id === "@finance/po-4471"));
});

/** What a reader must never be shown: the keys and titles of every document outside their collections, and "Heron". */
function hiddenFrom(reader: keyof typeof READERS): string[] {
  const reads: readonly string[] = READERS[reader];
  const hidden = CORPUS.filter((d) => !reads.includes(d.key.split("/")[0] ?? ""));
  return [...hidden.map((d) => `@${d.key}`), ...hidden.map((d) => d.title), "Heron"];
}

test("a partial reader's answers hold nothing from a collection they cannot read", {
  skip: skipWithoutDatabase,
}, () => {
  for (const c of CASES) {
    if (!c.partial) continue;
    const shown = JSON.stringify(withoutEchoes(answers[c.name]));
    for (const secret of hiddenFrom(c.partial))
      assert.ok(!shown.includes(secret), `${c.name}: shows ${secret}`);
  }
});

/**
 * A page with the reader's own typed words taken out where it names them back: each word no readable document holds,
 * in `corrected` and in the note's sentence about it. Whether a word is held is asked inside the reader's fence, so a
 * word only a hidden document holds is named exactly as a word nobody holds; what must never show is anything else.
 */
function withoutEchoes(page: unknown): unknown {
  const p = page as { corrected?: { from: string }[]; note?: string | null };
  if (!p?.corrected) return page;
  let note = p.note ?? null;
  for (const { from } of p.corrected) note = note?.replaceAll(`"${from}"`, '"…"') ?? null;
  const { corrected: _named, ...rest } = p;
  return { ...rest, note };
}

test("a collection a reader cannot read, named, gives them nothing", {
  skip: skipWithoutDatabase,
}, () => {
  for (const name of Object.keys(answers).filter((n) => n.endsWith("they cannot read"))) {
    const found = answers[name] as Record<string, unknown[] | undefined>;
    assert.deepEqual(found.sources ?? found.hits ?? found.documents, [], name);
  }
});

test("an identifier only a hidden document is, is nothing to a reader who cannot read it", {
  skip: skipWithoutDatabase,
}, () => {
  // A readable page may still mention it (`mentions`); what is hidden is that anything IS it.
  for (const name of Object.keys(answers).filter((n) => /^lookup by .*: a key only/.test(n)))
    assert.deepEqual((answers[name] as { is: unknown[] }).is, [], name);
  // Mentioned nowhere they can read, it reads exactly as an identifier nothing is.
  for (const reader of ["staff", "finance"])
    assert.equal(
      JSON.stringify(answers[`lookup by ${reader}: a key only the board holds`]).replaceAll(
        "BRD-118",
        "ZZZ-404",
      ),
      JSON.stringify(answers[`lookup by ${reader}: an identifier nothing is`]),
    );
});

test("a container inside one the reader cannot read is never named to them", {
  skip: skipWithoutDatabase,
}, () => {
  const named = /"container":\{"id":"http\/folder\/board(-shared)?"/;
  for (const c of CASES)
    if (c.partial) assert.ok(!named.test(JSON.stringify(answers[c.name])), c.name);
});

test("a hidden document and a missing one open the same way", { skip: skipWithoutDatabase }, () => {
  assert.deepEqual(
    answers["a reader opening a hidden document"],
    answers["a reader opening a document that does not exist"],
  );
});

test("paging shows each document once, over at least three pages", {
  skip: skipWithoutDatabase,
}, () => {
  for (const name of Object.keys(answers).filter((n) => n.endsWith("every page"))) {
    const pages = answers[name] as { sources: { id: string }[] }[];
    const ids = pages.flatMap((p) => p.sources.map((s) => s.id));
    assert.ok(pages.length >= 3, `${name}: ${pages.length} pages`);
    assert.equal(new Set(ids).size, ids.length, `${name}: a document twice`);
  }
});
