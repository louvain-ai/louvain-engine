/**
 * Whether a passage whose vectors were dropped is current for this read: one probe of the partial index that lists
 * dropped passages, by the witness times the writer stamped, then the reader's own rule (`passageFilter`). A dropped
 * passage outside the witnesses is retired for this read, so the rule is asked only of marked passages.
 */

import type { AddedFilters } from "../../../sources/filter-seam.js";
import type { Queryable } from "../../core/sql.js";
import type { Reader } from "../fence.js";
import { passageFilter } from "../passages-filter.js";
import type { PassageFilters } from "../passages-types.js";

type DroppedRead = {
  fence: Reader;
  filters: PassageFilters;
  /** The build's filters after the fence, which a record filter reads (`ReadHooks.filters`). */
  added: AddedFilters;
  validAt: string;
  knownAt: string | null;
  admitted: readonly string[];
};

/** One row when a dropped passage is current for this read, none otherwise. */
export const droppedCurrent = (q: Queryable, r: DroppedRead) => q<{ one: number }[]>`
        select 1 as one from passage p
         where p.org_id = ${r.fence.orgId} and p.vector_dropped_at is not null
           and (p.superseded_valid_from > ${r.validAt}
                -- sql-shape: only dropped passages, through the partial index that lists them, limit 1
                ${knownLater(q, r.knownAt)}
                -- sql-shape: only dropped passages, through the partial index that lists them, limit 1
                ${admittedById(q, r.admitted)})
           and ${passageFilter(q, r.fence, r.filters, r.added)}
         limit 1`;

const knownLater = (q: Queryable, knownAt: string | null) =>
  // sql-shape: only dropped passages, through the partial index that lists them
  knownAt !== null ? q`or p.superseded_known_from > ${knownAt}` : q``;

const admittedById = (q: Queryable, admitted: readonly string[]) =>
  // sql-shape: only dropped passages, through the partial index that lists them
  admitted.length > 0 ? q`or p.event_id = any(${admitted}::text[])` : q``;
