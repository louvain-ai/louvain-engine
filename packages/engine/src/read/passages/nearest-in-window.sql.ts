/**
 * The nearest passages of a small date range, read exactly: every candidate's distance computed, the nearest kept.
 * The range is a predicate inside an index scan that stops at its scan bound, so a narrow range read by the index
 * could come back short with nothing to say so.
 */
import type { Queryable } from "../../store/sql.js";
import { passageFilter } from "./filter.js";
import { passageColumns } from "./fragments.js";
import type { Row } from "./leg-types.js";
import type { VectorRead } from "./vector-legs.js";

/**
 * Each candidate's distance, nearest first, then the kept rows read whole: the sort carries an id and a distance, not
 * every candidate's text. `offset 0` keeps the planner from walking the index for the order.
 */
export const nearestInWindow = (q: Queryable, r: VectorRead) => q<Row[]>`
      select ${passageColumns(q)}, 1 - w.distance as score from (
        select id, distance from (
          select p.id, p.${q(r.columns.passage)} <=> ${r.vector}::vector as distance
            from passage p
           where ${passageFilter(q, r)} and p.${q(r.columns.passage)} is not null
          offset 0) c
         order by distance, id
         limit ${r.limit}) w
       join passage p on p.id = w.id
       order by w.distance, w.id`;
