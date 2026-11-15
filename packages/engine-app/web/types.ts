/** What the app's server sends: a search's page and its hits, a whole document, and the engine's status. */

/**
 * How a hit matched, as the engine says: its words, its meaning's closeness (null when not measured), and `exact`
 * (present only when true) when the search is, or holds, the document's own identifier or whole title.
 */
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
/**
 * A page: the matches, and apart from them what is only loosely related; `note` says why nothing matched. `refusal`
 * is the engine's sentence for a search it will not run (one with no word and no figure in it).
 */
export type Page = {
  sources: Hit[];
  looselyRelated: Hit[];
  matched: boolean;
  note: string | null;
  next: string | null;
  refusal?: string;
};
export type Doc = { id: string; title: string; date: string | null; text: string; cut: boolean };
export type Status = {
  documents: number;
  collections: { name: string; documents: number }[];
  /** Ready, or not: `needs` names the setting it lacks; without `needs`, the configuration names no answerer. */
  ask: { ready: true; answering: string } | { ready: false; needs?: string };
};
