/**
 * The engine's retrieval and reader switches: how a search ranks and what a page hands the reader. Each is read per
 * call, from the configuration's settings (`settings.ts`) or the environment (`environment.ts`). A host's own policies stay in its own switches.
 */

import { environment } from "./environment.js";
import { settings } from "./settings.js";

/**
 * An agent's search reads the person's question beside its own query (`search/question.ts` `questionFor`, and the
 * open server's schema, which offers `question` only while this is on): more first-place hits for a second set of legs.
 * `settings.retrieval.searchQuestion`.
 */
export const searchQuestionOn = (): boolean => settings().retrieval.searchQuestion;

/**
 * Whether a ranked page tells matches from documents only loosely related (`open/source-tools/search-relevance.ts`), and
 * puts the documents a search names first (`search-exact.ts`) and shows excerpts as written (`asWritten`):
 * `on` or `off` as set, else undefined, and the bound presentation decides (`search-relevance.ts` `relevanceSplit`).
 * Read per call.
 */
export function searchRelevanceSetting(): boolean | undefined {
  return environment("LOUVAIN_SEARCH_RELEVANCE");
}

/**
 * A BM25 hit's row is its document's best-matching passage, not its first (`plugins/retriever-keyword/bm25-rows.ts`, `firstChunkRows`
 * `bestFor`): the excerpt is the part that matched, for one ranked read of the document's passages. Every
 * `passages.search` the sidecar answers takes it. `settings.retrieval.bestPassage`.
 */
export const bm25BestPassageOn = (): boolean => settings().retrieval.bestPassage;
