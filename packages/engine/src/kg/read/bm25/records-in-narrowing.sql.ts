/**
 * Of a keyword index's hits, the records the passage reads' own filter keeps (`recordPredicates`), by id, so the
 * read is bounded by the page. An index built before a record changed app, or one rounded to seconds, then never
 * widens a narrowed page.
 */

import type { AddedFilters } from "../../../sources/filter-seam.js";
import type { Queryable } from "../../core/sql.js";
import { type RecordFilters, recordPredicates } from "../filters.js";

/** The ids, of `ids`, whose records meet `filters`. */
export const recordsInNarrowing = (
  q: Queryable,
  orgId: string,
  read: { ids: readonly string[]; filters: RecordFilters; added: AddedFilters },
) => q<{ id: string }[]>`
      select e.id from event_log e
       where e.org_id = ${orgId} and e.id = any(${[...read.ids]}::text[])
       ${recordPredicates(q, read.added, orgId, read.filters)}`;
