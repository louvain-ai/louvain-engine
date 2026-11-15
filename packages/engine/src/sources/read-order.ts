/** The order a listing is shown in: by relevance when there are words, else newest first unless oldest was asked. */
import type { Queryable } from "../kg/core/sql.js";
import type { SearchInput } from "./search-input.js";

/** The sort a listing uses for this input. */
export function sourceSort(input: Pick<SearchInput, "q" | "sort">) {
  return input.sort === "oldest"
    ? "oldest"
    : input.sort === "newest" || !input.q.trim()
      ? "newest"
      : "relevance";
}

/** Newest first unless the reader asked for oldest; ties broken by document id so a page is stable. */
export const walkOrder = (sql: Queryable, sort: ReturnType<typeof sourceSort>) =>
  sort === "oldest"
    ? sql`d.current_modified_at asc, d.id asc`
    : sql`d.current_modified_at desc, d.id asc`;
