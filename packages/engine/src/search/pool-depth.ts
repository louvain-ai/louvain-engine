import { environment } from "../config/environment.js";

/** How many passages the legs read for each document asked for. */
const PASSAGES_PER_DOCUMENT = 3;
/** `passages.search`'s own ceiling: a deeper pool is never asked for. */
const POOL_DEPTH_MAX = 200;

/**
 * How deep the legs read, in passages: `limit` × 3 by default (72 for the 24-deep head), or `LOUVAIN_SEARCH_POOL_DEPTH`
 * where that is deeper, up to 200. Each leg reads to this depth and the fused list is cut to it, so two 72-long lists
 * keep about each leg's top 36: a document one leg ranks lower may never reach the reranker. Read at each call.
 */
export function poolDepth(limit: number): number {
  const asked = Math.floor(Number(environment("LOUVAIN_SEARCH_POOL_DEPTH")));
  const base = limit * PASSAGES_PER_DOCUMENT;
  return Number.isFinite(asked) && asked > base ? Math.min(asked, POOL_DEPTH_MAX) : base;
}
