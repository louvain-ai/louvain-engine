import { searchQuestionOn } from "../config/engine-switches.js";

/** A question longer than this is cut: it is one person's turn, not a document. */
const QUESTION_CHARS = 2_000;

/**
 * THE PERSON'S QUESTION IS SEARCHED TOO, unless `LOUVAIN_SEARCH_QUESTION=off`: an agent searches with its own rewrite of
 * what was asked, and a rewrite drops words the question had. A question that is not the query itself is read beside
 * it under the same fence, fused into one pool, and ranks the page; otherwise null. Read at each call.
 */
export function questionFor(query: string, question: string | undefined): string | null {
  if (!searchQuestionOn()) return null;
  const q = Array.from((question ?? "").trim())
    .slice(0, QUESTION_CHARS)
    .join("");
  const same = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return q.length === 0 || same(q) === same(query) ? null : q;
}
