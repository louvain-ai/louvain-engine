import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../kg/read/fence.js";
import { askSettings } from "../../memory/modes.js";
import type { SearchPool, SearchWith } from "../../search/document.js";
import type { SearchCursor } from "./search-paging.js";
import { measured } from "./search-relevance.js";
import { str } from "./tool-helpers.js";

/**
 * The reranker reorders a page; it never adds to one, and is not asked where it could do neither: a search that only
 * names things, or holds nothing to mean, is its named documents alone, so the same pool reads it with no reranker.
 */
export const unranked = (using: SearchWith): SearchWith => ({
  ...using,
  pool: Object.assign((...args: Parameters<SearchPool>) => using.pool(...args), { reranker: null }),
});

/** Whether the search is measured by meaning, decided once: one that is not is read without the reranker. */
export async function rankingOf(
  context: ReadContext,
  owner: Viewer,
  args: Record<string, unknown>,
  at: { cursor: SearchCursor; pool: SearchWith },
) {
  const mode = args.mode === "keyword" ? ("keyword" as const) : ("hybrid" as const);
  const meaning =
    at.cursor.p === "ranked" ? await measured(context, owner, str(args.query), mode) : undefined;
  return {
    mode,
    meaning,
    ranking: meaning === null && mode !== "keyword" ? unranked(at.pool) : at.pool,
  };
}

/** How a search reads: an answer's normal recall and reranking, from the one place the answer path reads them. */
export function readAs() {
  const { recall, rerank } = askSettings("normal");
  return { recall, rerank };
}
