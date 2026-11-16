/**
 * The nearest passages of a small date range, read exactly: every candidate's distance computed, the nearest kept.
 * The range is a predicate inside an index scan that stops at its scan bound, so a narrow range read by the index
 * could come back short with nothing to say so.
 */
import type { Queryable } from "../../store/sql.js";
import { passageFilter } from "./filter.js";
import { passageColumns } from "./fragments.js";
import type { Row } from "./types.js";
import type { VectorRead } from "./vector-legs.js";

/** Each candidate's distance, nearest first; `offset 0` keeps the planner from walking the index for the outer order. */
export const nearestInWindow = (q: Queryable, r: VectorRead) => q<Row[]>`
      select id, event_id, seq, text, container, author, occurred_at, 1 - distance as score from (
        select ${passageColumns(q)},
               p.${q(r.columns.passage)} <=> ${r.vector}::vector as distance
          from passage p
         where ${passageFilter(q, r.fence, r.filters, r.added)} and p.${q(r.columns.passage)} is not null
        offset 0) w
       order by distance, id
       limit ${r.limit}`;
