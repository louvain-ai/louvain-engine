/**
 * Of a keyword index's hits, the records the passage reads' own filter keeps (`documentPredicates`), by id, so the
 * read is bounded by the page. An index built before a record changed app, or one rounded to seconds, then never
 * widens a narrowed page.
 */

import type { Queryable } from "../../store/sql.js";
import { type DocumentFilters, documentPredicates } from "../filters.js";
import type { AddedFilters } from "../listing/filter-seam.js";

/** The ids, of `ids`, whose records meet `filters`. */
export const revisionsInNarrowing = (
  q: Queryable,
  orgId: string,
  read: { ids: readonly string[]; filters: DocumentFilters; added: AddedFilters },
) => q<{ id: string }[]>`
      select e.id from event_log e
       where e.org_id = ${orgId} and e.id = any(${[...read.ids]}::text[])
       ${documentPredicates(q, { added: read.added, orgId, filters: read.filters })}`;
