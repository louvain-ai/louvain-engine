import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { normalise, readGolden, writeGolden, writing } from "./golden.js";

/**
 * The page with a reranker configured, pinned. The stand-in reranker (`stand-ins.ts`) scores by the search's words and
 * carries measured cut-offs, as a shipped model does. Each answer is recorded in `search.reranked.golden.json`, and
 * beside the recording the rules that hold whatever is recorded: a search for nothing shows nothing; a real word no
 * document holds matches nothing, its nearest listed apart; an answer worded differently from the search still
 * matches; a document the search names still leads; a search that only names things is its named documents alone,
 * however a score falls; and every hit says why it matched.
 */
const GOLDEN = new URL("./search.reranked.golden.json", import.meta.url);
const recorded = readGolden(GOLDEN);
const answers: Record<string, unknown> = {};
let engine: Engine;

type Hit = { id: string; match?: { by?: string; relevance?: number; ranks?: unknown } };
type Page = { sources?: Hit[]; looselyRelated?: Hit[]; matched?: boolean; note?: string | null };

const CASES: [string, Record<string, unknown>][] = [
  ["random letters", { query: "ibobsonosoino78h9", limit: 5 }],
  ["a real word in no document", { query: "highfield", limit: 5 }],
  ["an answer in other words", { query: "automobile", limit: 5 }],
  ["an identifier", { query: "FIN-2207", limit: 5 }],
  ["plain words", { query: "parental leave", limit: 5 }],
  ["a search that only names a code", { query: "PO-4471", limit: 5 }],
  ["a figure written another way", { query: "4,471", limit: 5 }],
];

/** A page the reranker may only reorder: what a names-only search returns, or nothing at all. */
const NAMES_ONLY = new Set(["a search that only names a code", "a figure written another way"]);

before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("reranked");
});
after(async () => {
  if (writing && !skipWithoutDatabase)
    for (const line of writeGolden(GOLDEN, recorded, answers)) console.log(line);
  await engine?.close();
});

const page = async (name: string, args: Record<string, unknown>): Promise<Page> => {
  answers[name] = normalise(await engine.rerankedTool("louvain_search_sources", args), engine.ids);
  if (!writing) assert.deepEqual(answers[name], recorded[name]);
  return answers[name] as Page;
};

for (const [name, args] of CASES)
  test(name, { skip: skipWithoutDatabase }, async () => {
    const got = await page(name, args);
    for (const hit of got.sources ?? []) assert.ok(hit.match?.by, `${hit.id} says why it matched`);
    if (name === "random letters") {
      assert.deepEqual([got.sources, got.looselyRelated], [[], []]);
      assert.equal(got.matched, false);
      // The word no readable document holds is named first (`search-unheld.ts`), then that nothing matches.
      assert.match(
        got.note ?? "",
        /searched without it\. Nothing in your documents matches this search/,
      );
    }
    if (name === "a real word in no document") assert.equal(got.matched, false);
    if (name === "an answer in other words")
      assert.ok(got.sources?.some((h) => h.id === "@handbook/own-car"));
    if (NAMES_ONLY.has(name)) {
      assert.deepEqual(got.looselyRelated, []);
      for (const hit of got.sources ?? []) assert.notEqual(hit.match?.by, "relevance", hit.id);
    }
    if (name === "an identifier") {
      assert.equal(got.sources?.[0]?.id, "@finance/fin-2207");
      assert.equal(got.sources?.[0]?.match?.by, "exact");
    }
  });
