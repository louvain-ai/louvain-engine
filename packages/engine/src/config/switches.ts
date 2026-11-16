/**
 * The engine's retrieval and reader switches the environment sets: how a search ranks and what a page hands the reader,
 * each read per call (`environment.ts`). What a configuration sets is its engine's settings (`settings.ts`), and a
 * host's own policies stay in its own switches.
 */

import { environment } from "./environment.js";

/**
 * Whether a ranked page tells matches from documents only loosely related (`server/tools/search-relevance.ts`), and
 * puts the documents a search names first (`search-exact.ts`) and shows excerpts as written (`asWritten`):
 * `on` or `off` as set, else undefined, and the bound presentation decides (`search-relevance.ts` `relevanceSplit`).
 * Read per call.
 */
export function searchRelevanceSetting(): boolean | undefined {
  return environment("LOUVAIN_SEARCH_RELEVANCE");
}
