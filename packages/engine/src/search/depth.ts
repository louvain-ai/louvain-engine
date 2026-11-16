import { environment } from "../config/environment.js";

/** How deep the agent's ranked head is, and what a caller already showed (`search/search.ts` reads both). */

/** At most this many documents a call (the 24-row head). */
const SEARCH_DOCUMENTS_MAX = 24;

/**
 * A wide page (`LOUVAIN_SEARCH_WIDE=on`, off by default, read per call): the ranked head is `SEARCH_WIDE_MAX` documents
 * deep instead of `SEARCH_DOCUMENTS_MAX`, its tail compact as the default page's is, so a model reads a hundred
 * candidates a search by title, date and a short snippet. The legs read deeper to fill it.
 */
const SEARCH_WIDE_MAX = 100;
export function searchHeadDepth(): number {
  return environment("LOUVAIN_SEARCH_WIDE") ? SEARCH_WIDE_MAX : SEARCH_DOCUMENTS_MAX;
}

/**
 * Sources already shown leave the page and take no place on it: the head is cut at `want` after they go, from a prefix
 * of the same ranked order read long enough for them. An id the reader cannot read removes nothing and moves nothing.
 * `more` stays true when the order held more than the page.
 */
export function withoutShown<D extends { summary: { id: string } }>(
  documents: readonly D[],
  {
    exclude,
    want,
    further,
  }: { exclude: ReadonlySet<string> | undefined; want: number; further: boolean },
): { kept: D[]; more: boolean } {
  const left = exclude ? documents.filter((d) => !exclude.has(d.summary.id)) : [...documents];
  return { kept: left.slice(0, want), more: further || left.length > want };
}
