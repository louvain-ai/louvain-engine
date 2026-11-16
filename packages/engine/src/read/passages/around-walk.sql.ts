/**
 * The `k` messages one side of a hit in its own collection, by the time they were said: bounded by count, never by
 * a time window, and read through the search's own fence and filters, so a neighbour the reader cannot read is not
 * there. Each walk is an index range of a few rows, never a sort of the collection.
 */
import type { Queryable } from "../../store/sql.js";
import { type Anchor, type AroundRead, notSuperseded } from "./around-read.js";
import { passageFilter } from "./filter.js";

/** A message beside a hit, `rn` messages away in direction `dir`. */
export type Near = {
  anchor: string;
  event_id: string;
  container: string;
  author: string | null;
  occurred_at: Date;
  text: string;
  dir: number;
  rn: number;
  linked: boolean;
};

/** The `k` nearest messages before (`dir` -1) or after (1) the hit `a`. */
export const walkFrom = (
  q: Queryable,
  r: AroundRead & { k: number },
  { a, dir }: { a: Anchor; dir: number },
) =>
  q<Near[]>`
                select ${a.event_id} as anchor, p.event_id, p.container, p.author, p.occurred_at, p.text,
                       ${dir}::int as dir, false as linked,
                       row_number() over (order by ${walkOrder(q, dir)})::int as rn
                  from (select p.event_id, p.container, p.author, p.occurred_at, p.text
                          from passage p
                         where ${passageFilter(q, r)} and p.seq = 0
                           and p.container = ${a.container}
                           and ${notSuperseded(q, r, a)}
                           and ${beyond(q, a, dir)}
                         order by ${walkOrder(q, dir)}
                         limit ${r.k}) p`;

const walkOrder = (q: Queryable, dir: number) =>
  dir < 0 ? q`p.occurred_at desc, p.event_id desc` : q`p.occurred_at, p.event_id`;

const beyond = (q: Queryable, a: Anchor, dir: number) =>
  dir < 0
    ? q`(p.occurred_at, p.event_id) < (${a.at}::text::timestamptz, ${a.event_id})`
    : q`(p.occurred_at, p.event_id) > (${a.at}::text::timestamptz, ${a.event_id})`;
