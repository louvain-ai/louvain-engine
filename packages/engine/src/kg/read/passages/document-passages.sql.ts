/**
 * Each record's readable passages in their order, for reading the record as one text: one statement for the page,
 * bounded by the records asked for. Every readable passage of those records is ranked by a running sum of its length
 * and only those before `cap` come back, so a very long record costs its passages' count, never more text.
 */

import type { AddedFilters } from "../../../sources/filter-seam.js";
import type { Queryable } from "../../core/sql.js";
import type { AsOf } from "../context.js";
import type { Reader } from "../fence.js";
import { passageFilter } from "../passages-filter.js";

type DocumentRead = {
  fence: Reader;
  ids: string[];
  asOf: AsOf | undefined;
  cap: number;
  added: AddedFilters;
};

/** The passages of `ids` that start before `cap` characters, by record and place. */
export const documentPassages = (q: Queryable, r: DocumentRead) => q<
  { event_id: string; seq: number; text: string; context: string | null }[]
>`
      select event_id, seq, text, context from (
        select p.event_id, p.seq, p.text, p.context,
               coalesce(sum(length(p.text) + 1) over (partition by p.event_id order by p.seq
                 rows between unbounded preceding and 1 preceding), 0) as taken
          from passage p
         where ${passageFilter(q, r.fence, { recordIds: r.ids, ...(r.asOf ? { asOf: r.asOf } : {}) }, r.added)}
      ) read where taken < ${r.cap}
      order by event_id, seq`;
