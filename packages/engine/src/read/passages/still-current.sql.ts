/**
 * Of some records, those still their record's current version for this reader: the hits a keyword index ranked,
 * which no fenced passage read filtered. The version rule is the caller's fragment (`newerVersionRead`), so the
 * rule a hit is held to is the one every passage read carries.
 */
import type { Row as DriverRow, PendingQuery } from "postgres";
import type { Queryable } from "../../store/sql.js";

type CurrentRead = {
  orgId: string;
  eventIds: readonly string[];
  /** The version rule on the record `e`: true when a newer version retires it for this reader. */
  newer: PendingQuery<DriverRow[]>;
};

/** The ids, of `eventIds`, no newer version retires. */
export const currentRevisions = (q: Queryable, r: CurrentRead) => q<{ id: string }[]>`
      select e.id from event_log e
       where e.org_id = ${r.orgId} and e.id = any(${[...r.eventIds]}::text[])
         and not (e.record_key is not null and ${r.newer})`;
