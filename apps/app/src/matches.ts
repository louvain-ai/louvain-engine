import { queryTerms, termRanges } from "../web/terms.js";

/**
 * What a search found, in the engine's shape: per hit `match: { words, meaning }`, per page `matched`, `note`, and the
 * hits split into `sources` (matches) and `looselyRelated` (the rest, never mixed in). The engine decides which is
 * which (`fromEngine`): the app applies no threshold and shows no fused score. A page without those fields is split
 * by `derived`, which builds the nearest honest version from what the page does carry.
 */

/** `exact`, present only when true: the search is, or holds, the document's own identifier or whole title. */
export type Match = {
  words: boolean;
  meaning: number | null;
  exact?: true;
  /** A reranker's score, 0 to 1, when one ran: the page's headline number. */
  relevance?: number;
  /** Its place in the words list and in the meaning list in the fused lists (null: not in that list). */
  ranks?: { words: number | null; meaning: number | null };
};
export type Hit = { id: string; title: string; date: string | null; passage: string; match: Match };
export type Found = {
  sources: Hit[];
  looselyRelated: Hit[];
  matched: boolean;
  note: string | null;
};

type EnginePage = { matched?: unknown; note?: unknown; looselyRelated?: unknown[] };

/** The engine's own split, when the page carries it; null when it does not (detected by presence, not version). */
export function fromEngine(
  page: EnginePage,
  hits: Hit[],
  loose: (raw: unknown[]) => Hit[],
): Found | null {
  if (typeof page.matched !== "boolean") return null;
  return {
    sources: hits,
    looselyRelated: loose(page.looselyRelated ?? []),
    matched: page.matched,
    note: typeof page.note === "string" ? page.note : null,
  };
}

/**
 * The split of a page the engine did not split. A hit's `words` is whether its passage or title holds one
 * of the query's words; `meaning` is unknown (null), so nothing is said of it. A page is unmatched only when no hit
 * holds a word and no document the keyword search finds holds one either (a keyword search alone also finds the
 * small words every question has): then every hit is loosely related, and the note claims only what was checked.
 */
export async function derived(
  query: string,
  hits: Omit<Hit, "match">[],
  byKeyword: () => Promise<Omit<Hit, "match">[]>,
): Promise<Found> {
  const terms = queryTerms(query);
  const words = (h: Omit<Hit, "match">) => termRanges(`${h.title}\n${h.passage}`, terms).length > 0;
  const marked = hits.map((h) => ({ ...h, match: { words: words(h), meaning: null } }));
  if (hits.length === 0 || marked.some((h) => h.match.words) || (await byKeyword()).some(words))
    return { sources: marked, looselyRelated: [], matched: hits.length > 0, note: null };
  return {
    sources: [],
    looselyRelated: marked,
    matched: false,
    note: "No document contains the words of this search.",
  };
}
