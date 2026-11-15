import type { Match } from "./types.js";

/**
 * A result's numbers, in plain words, from whatever the engine sent (each field read by its presence). The headline is
 * the reranker's relevance when there is one, else the similarity in meaning; the detail names every number the hit
 * carries and what it means. Nothing is computed here that the engine did not send. Pure: a match in, words out.
 */

export type Headline = { figure: string; name: string; meter: number | null };

const two = (n: number) => n.toFixed(2);

/** "1st", "2nd", "97th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * The number a row shows: the relevance (with a meter), else the similarity, else its rank by its words; null when the
 * engine sent none of them, and the row then shows no number at all.
 */
export function headline(match: Match): Headline | null {
  if (typeof match.relevance === "number")
    return { figure: two(match.relevance), name: "relevance", meter: match.relevance };
  if (typeof match.meaning === "number")
    return { figure: two(match.meaning), name: "similarity", meter: null };
  if (typeof match.ranks?.words === "number")
    return { figure: `#${match.ranks.words}`, name: "rank by its words", meter: null };
  return null;
}

/** How the two searches ranked it, each on its own, and where it came out on this page. */
function ranked(match: Match, place: number): string | null {
  const r = match.ranks;
  if (!r) return null;
  const by = [
    r.words !== null ? `${ordinal(r.words)} by its words` : "not found by its words",
    r.meaning !== null ? `${ordinal(r.meaning)} by meaning` : "not found by meaning",
  ];
  return `Ranked ${by.join(", ")}; ${ordinal(place)} once the two were combined.`;
}

/** Every number the result carries, each in a sentence; `place` is its position in the list, from 1. */
export function reasons(match: Match, place: number): string[] {
  const lines = [
    match.exact ? "Exact: the search is this document's own identifier or title." : null,
    match.words ? "It holds the words of the search." : "It does not hold the words of the search.",
    typeof match.relevance === "number"
      ? `Relevance ${two(match.relevance)}: the reranker's judgement of how well it answers the search, 0 to 1.`
      : null,
    typeof match.meaning === "number"
      ? `Similarity ${two(match.meaning)}: how close its best passage is in meaning to the search, 0 to 1.`
      : null,
    ranked(match, place),
  ].filter((l): l is string => l !== null);
  const numbers =
    typeof match.relevance === "number" || typeof match.meaning === "number" || match.ranks;
  const unscored =
    "A search for a name or a figure is matched by the documents that hold it, not scored by meaning.";
  return numbers ? lines : [...lines, unscored];
}
