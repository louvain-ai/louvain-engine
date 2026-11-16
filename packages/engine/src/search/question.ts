import type { SearchWith } from "./pool-types.js";
import type { SearchRequest } from "./search.js";

/** A question longer than this is cut: it is one person's turn, not a document. */
const QUESTION_CHARS = 2_000;

/**
 * The person's question is searched too, where the engine's settings say so (`retrieval.searchQuestion`, `on`): an
 * agent searches with its own rewrite of what was asked, and a rewrite drops words the question had. A question that is
 * not the query itself is read beside it under the same fence, fused into one pool, and ranks the page; otherwise null.
 */
export function questionFor(
  { query, options }: Pick<SearchRequest, "query" | "options">,
  { settings }: Pick<SearchWith, "settings">,
): string | null {
  if (!settings.retrieval.searchQuestion) return null;
  const q = Array.from((options.question ?? "").trim())
    .slice(0, QUESTION_CHARS)
    .join("");
  const same = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return q.length === 0 || same(q) === same(query) ? null : q;
}
