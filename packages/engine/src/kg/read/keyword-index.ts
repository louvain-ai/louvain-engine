import type { Viewer } from "@louvain/engine-core";
import type { PendingQuery, Row as SqlRow } from "postgres";
import type { Queryable } from "../core/sql.js";
import { type Bm25Endpoint, bm25, bm25Endpoint } from "./bm25.js";
import type { ReadContext, Reader } from "./fence.js";
import type {
  KeywordLegRead,
  PassageFilters,
  PassageLegRead,
  PassageRead,
  Row,
} from "./passages-types.js";
import { tierWords } from "./tier-words.js";

/**
 * A second matcher's titled documents: readable documents whose title shares the search's words, one passage each,
 * at most `limit` (`search/titled.ts` places them on the page).
 */
type TitleRead = (
  context: ReadContext,
  viewer: Viewer,
  query: string,
  opts: { limit: number; strict?: true; filters?: PassageFilters },
) => Promise<PassageRead[]>;

/** A second matcher's recency read: the newest readable passages, matching the search's words where it has any. */
type RecentRead = (
  context: ReadContext,
  leg: PassageLegRead & { rareTopic: boolean },
) => Promise<Row[]>;

/**
 * Which of a document's passages shows it, as an order over `passage` that puts that one first: from the index's hits'
 * snippets (`snippets`, by record) or the search's words (`terms`). Null: the document's first passage.
 */
type BestPassage = (
  q: Queryable,
  hits: { terms: readonly string[]; snippets: ReadonlyMap<string, string> },
) => PendingQuery<SqlRow[]> | null;

/** What answers a keyword read the index does not carry. */
type KeywordPasses = (context: ReadContext, leg: KeywordLegRead) => Promise<Row[]>;

/**
 * WHICH RECORDS AND WORDS THE SEARCH'S WORDS ARE HELD BY, under a reader's fence: `holders` of these records (`ids`),
 * those holding the search's words; `held` of these words, those a readable passage holds. A page says with it which of
 * its documents match by their words (`relevance.ts`); ranking never reads it.
 */
export type WordsTest = {
  holders(
    context: ReadContext,
    reader: Reader,
    search: { query: string; ids: readonly string[] },
  ): Promise<Set<string>>;
  held(context: ReadContext, reader: Reader, words: readonly string[]): Promise<Set<string>>;
};

/**
 * WHAT A BUILD'S KEYWORD INDEX IS, handed to its reads in their context (`ReadHooks.keyword`) and to its writes in
 * theirs (`writes.ts`), which ask whether it holds document entries:
 *
 *   `passes`     what answers a keyword read the index does not: a build that keeps a second matcher hands its own
 *                Postgres passes. `null` is a build that REQUIRES its
 *                index, as it requires Postgres: a read the index cannot answer (down, or a filter it does not carry)
 *                has no keyword leg, says so in `degraded`, and the page stands on its other legs.
 *   `documents`  whether the index also holds ONE ENTRY PER DOCUMENT beside its records' entries
 *                (`sources/keyword-documents.ts`), for a listing read from the index. A build whose listing reads
 *                Postgres writes none.
 *   `tiers`      whether a keyword read asks the index's tiers (`keyword/tiers.ts`, Meilisearch's matching strategy,
 *                with a word no readable document holds asked as a prefix or a typo) and a page names the words it
 *                searched another way. A build without them ranks by one BM25 query.
 *   `recent`     the recency read (`RecentRead`), the order a search asked as `order: "recent"` is read in: a second
 *                matcher's. The open build has none (`noRecency`), and no open read asks for it.
 *   `best`       which passage shows a document the keyword leg found (`BestPassage`): the open build's is the one
 *                holding the hit's snippet, where the index's words fell (`snippetPassage`).
 *   `titles`     a second matcher's title read (`TitleRead`), whose documents the search places on its first page: the
 *                open build has none, its index holding a title as the document's header.
 *   `words`      the words test (`WordsTest`): the open build's is the index's tiers' (`tier-words.ts`); a build that
 *                keeps a second matcher hands its own.
 *   `endpoint`   the index's endpoint (`bm25.ts` `Bm25Endpoint`): its settings, read on its first call, and its group
 *                commit. The open build makes one per engine (`openKeywordIndex`); a build that keeps one index for
 *                its process hands the door's (`bm25`).
 */
export type KeywordIndex = {
  passes: KeywordPasses | null;
  titles: TitleRead | null;
  recent: RecentRead;
  best: BestPassage;
  documents: boolean;
  tiers: boolean;
  words: WordsTest;
  endpoint: Bm25Endpoint;
};

/**
 * THE OPEN BUILD'S BEST PASSAGE: the one holding the index's snippet for its record, the fragment where the search's
 * words fell (`apps/nlp/bm25_query.py` `_highlight`), compared with runs of whitespace as one space, since a passage is
 * stored on one line and the record keeps its breaks. Measured on the search table and the engine's cases: every
 * snippet lies whole in one passage. A record with no snippet (its words only in its title) shows its first.
 */
function snippetPassage(q: Queryable, { snippets }: { snippets: ReadonlyMap<string, string> }) {
  if (snippets.size === 0) return null;
  const ids = [...snippets.keys()];
  const fragments = ids.map((id) => snippets.get(id) ?? "");
  return q`coalesce(strpos(regexp_replace(text, '\\s+', ' ', 'g'), (select regexp_replace(f.fragment, '\\s+', ' ', 'g')
      from unnest(${ids}::text[], ${fragments}::text[]) as f(event_id, fragment) where f.event_id = passage.event_id)) > 0,
      false) desc,`;
}

/** The open build's recency read: none, said as `recent:none`. */
async function noRecency(_context: ReadContext, leg: PassageLegRead): Promise<Row[]> {
  leg.degraded.push("recent:none");
  return [];
}

/**
 * The open build's keyword index, REQUIRED (a read no engine made asks it, on the door's endpoint): no Postgres passes answer in its place (a read it cannot answer has no
 * keyword leg, and says so); it holds one entry per document (`sources/keyword-documents.ts`), which its listing reads;
 * and its reads and words test ask its tiers (`keyword/tiers.ts`, `tier-words.ts`).
 */
export const OPEN_KEYWORD_INDEX: KeywordIndex = {
  passes: null,
  titles: null,
  recent: noRecency,
  best: snippetPassage,
  documents: true,
  tiers: true,
  words: tierWords,
  endpoint: bm25,
};

/** The open build's keyword index for one engine (`createEngine`): an endpoint of that engine's own. */
export const openKeywordIndex = (): KeywordIndex => ({
  ...OPEN_KEYWORD_INDEX,
  endpoint: bm25Endpoint(),
});
