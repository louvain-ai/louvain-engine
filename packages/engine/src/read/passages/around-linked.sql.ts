/**
 * The earlier messages a hit is linked back to, read through the same fence, collection, earlier-than-the-hit bound
 * and version rule as its walk: the links are only ids to try, so the search's fence decides what is shown.
 */
import type { Queryable } from "../../store/sql.js";
import { type Anchor, type AroundRead, notSuperseded } from "./around-read.js";
import type { Near } from "./around-walk.sql.js";
import { passageFilter } from "./filter.js";

/** The readable messages of `back` said before the hit `a`, in no order. */
export const linkedBefore = (q: Queryable, r: AroundRead, a: Anchor, back: string[]) => q<
  Omit<Near, "rn">[]
>`
              select ${a.event_id} as anchor, p.event_id, p.container, p.author, p.occurred_at, p.text,
                     -1 as dir, true as linked
                from passage p
               where ${passageFilter(q, r.fence, { ...r.filters, recordIds: back }, r.added)} and p.seq = 0
                 and p.container = ${a.container}
                 and ${notSuperseded(q, r, a)}
                 and (p.occurred_at, p.event_id) < (${a.at}::text::timestamptz, ${a.event_id})`;
