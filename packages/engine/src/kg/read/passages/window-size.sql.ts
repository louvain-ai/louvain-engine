/**
 * How many passages a windowed vector read would weigh, counted under the same fence and filters and stopped at
 * `cap`, so the count is bounded by what the read could read exactly, never by the size of the store.
 */
import type { Queryable } from "../../core/sql.js";
import { passageFilter } from "../passages-filter.js";
import type { VectorRead } from "./vector-legs.js";

/** The window's passages with a bare vector, up to `cap`. */
export const windowSize = (
  q: Queryable,
  r: Pick<VectorRead, "fence" | "filters" | "added" | "columns">,
  cap: number,
) => q<{ n: number }[]>`
        select count(*)::int as n from (
          select 1 from passage p
           where ${passageFilter(q, r.fence, r.filters, r.added)} and p.${q(r.columns.passage)} is not null
           limit ${cap}) w`;
