import type { PendingQuery, Row } from "postgres";
import {
  type AddedFilters,
  FilterUnsupported,
  genreIn,
  type Named,
} from "../../sources/filter-seam.js";
import { filterApp } from "../../sources/read-core.js";
import type { Queryable } from "../core/sql.js";
import { connectorsOfApp } from "./connector-apps.js";

/**
 * Filters on the record a row came from, shared by `passages.search` and `records.window`. Each narrows inside the
 * fence the caller already put in the same WHERE clause; none can widen it.
 */
export type RecordFilters = {
  /** The actor (`actor_id` or `actor_email`), or a `from` participant where one is bound (`names`), lower-cased. */
  sender?: string;
  /** Every listed identifier appears as the actor or as a participant in any role; refused where none is bound. */
  participants?: string[];
  /** `from` inclusive, `to` exclusive, on the record's own time. */
  window?: { from?: string; to?: string };
  /** The record's connector. */
  connectors?: string[];
  /**
   * The app the record shows as (its own `presentation.service`, else its connector's app), or its connector's type.
   * A label and a filter, never an ACL input. Only for a read whose candidates are already bound (the passage legs):
   * `records.window` has no `apps`, since its walk would probe every event in the period.
   */
  apps?: string[];
  /**
   * The record's genre, by the predicate an application binds (`filter-seam.ts` `genreIn`), refused where none is:
   * `include` needs one in the list, so a record with none does not match; `exclude` drops a record with one in the
   * list and keeps one with none.
   */
  genre?: { include?: string[]; exclude?: string[] };
};

type Fragment = PendingQuery<Row[]>;

export const hasRecordFilters = (f: RecordFilters | undefined): boolean =>
  f !== undefined &&
  (f.sender !== undefined ||
    (f.participants?.length ?? 0) > 0 ||
    f.window?.from !== undefined ||
    f.window?.to !== undefined ||
    (f.connectors?.length ?? 0) > 0 ||
    (f.apps?.length ?? 0) > 0 ||
    (f.genre?.include?.length ?? 0) > 0 ||
    (f.genre?.exclude?.length ?? 0) > 0);

/**
 * Whether `e` (an `event_log` row in scope as `e`) names this identifier as its actor, or as a participant by the
 * build's predicate (`AddedFilters.participant`), OR-ed inside these parentheses. A filter that needs a participant
 * (`labels: "required"`) is refused where the build has none; a sender is then matched by the actor alone.
 */
const names = (
  sql: Queryable,
  added: AddedFilters,
  named: Named,
  labels: "required" | "optional",
): Fragment => {
  const participant = added.participant;
  if (participant === null && labels === "required") throw new FilterUnsupported("`participants`");
  return sql`
  (lower(e.actor_id) = ${named.value} or lower(coalesce(e.actor_email, '')) = ${named.value}${
    participant === null
      ? sql``
      : sql`
   or ${participant(sql, named)}`
  })`;
};

/**
 * The filters as `and …` predicates over `event_log e`, the build's among them (`added`). `occurredAt` names the column
 * the window applies to, so a passage leg can put it on the passage's own indexed time.
 */
export function recordPredicates(
  sql: Queryable,
  added: AddedFilters,
  orgId: string,
  f: RecordFilters,
  occurredAt: Fragment = sql`e.occurred_at`,
): Fragment {
  const parts: Fragment[] = [];
  if (f.sender !== undefined) {
    const who = f.sender.trim().toLowerCase();
    parts.push(
      sql`and ${names(sql, added, { orgId, value: sql`${who}`, roles: ["from"] }, "optional")}`,
    );
  }
  const participants = [...new Set((f.participants ?? []).map((p) => p.trim().toLowerCase()))];
  if (participants.length > 0) {
    parts.push(sql`and not exists (
      select 1 from unnest(${participants}::text[]) as want(v)
      where not ${names(sql, added, { orgId, value: sql`want.v`, roles: null }, "required")})`);
  }
  if (f.window?.from !== undefined) parts.push(sql`and ${occurredAt} >= ${f.window.from}`);
  if (f.window?.to !== undefined) parts.push(sql`and ${occurredAt} < ${f.window.to}`);
  if (f.connectors && f.connectors.length > 0) {
    parts.push(sql`and e.connector = any(${f.connectors}::text[])`);
  }
  if (f.apps && f.apps.length > 0) {
    // Its connector's type as before (a record with no source revision keeps it), or the app it is shown as. A SCALAR
    // subquery by the revision's primary key, one probe per candidate row: an `exists` under an OR may be planned as a
    // hashed subplan, one scan of every revision with that app, which no index bounds to the tenant.
    const types = [...new Set(f.apps.flatMap(connectorsOfApp))];
    parts.push(sql`and (e.connector = any(${types}::text[]) or (select ${filterApp(sql, added.app)} from source_revision r
      join source_document d on d.id = r.source_id
      where r.event_id = e.id and d.org_id = ${orgId}) = any(${f.apps}::text[]))`);
  }
  if (f.genre?.include && f.genre.include.length > 0) {
    parts.push(sql`and (${genreIn(added, sql, orgId, f.genre.include)})`);
  }
  if (f.genre?.exclude && f.genre.exclude.length > 0) {
    parts.push(sql`and not (${genreIn(added, sql, orgId, f.genre.exclude)})`);
  }
  return parts.reduce((acc, p) => sql`${acc} ${p}`, sql``);
}
