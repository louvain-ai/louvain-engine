import type { SourceSearch } from "@louvain/engine-core";

/** The page when nothing is readable: no sources, no counts, the sort the request would have used. */
export function emptySearch(
  input: { offset: number; q: string },
  sort: NonNullable<SourceSearch["sort"]>,
): SourceSearch {
  return {
    sources: [],
    total: 0,
    facets: [],
    offset: input.offset,
    hasMore: false,
    retrieval: input.q ? "keyword" : "recent",
    sort,
  };
}
