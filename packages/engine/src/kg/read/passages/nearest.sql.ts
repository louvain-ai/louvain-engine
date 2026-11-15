/**
 * The nearest passages by their bare vector, under the fence and the read's filters, as the index scan ranks them.
 * The scan runs under the vector leg's settings, without which a fenced scan returns a short page.
 */
import type { Queryable } from "../../core/sql.js";
import { passageFilter } from "../passages-filter.js";
import type { Row } from "../passages-types.js";
import { passageColumns } from "./fragments.js";
import type { VectorRead } from "./vector-legs.js";

/** The nearest `limit` passages, each scored by its similarity to the query. */
export const nearest = (q: Queryable, r: VectorRead) => q<Row[]>`
      select ${passageColumns(q)},
             1 - (p.${q(r.columns.passage)} <=> ${r.vector}::vector) as score
        from passage p
       where ${passageFilter(q, r.fence, r.filters, r.added)} and p.${q(r.columns.passage)} is not null
       order by p.${q(r.columns.passage)} <=> ${r.vector}::vector
       limit ${r.limit}`;
