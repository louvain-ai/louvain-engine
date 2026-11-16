import { GENERATED_VIAS } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import { type ContainerSetShape, fenced } from "../fenced.js";
import { displayApp, namedConnection } from "./apps.js";
import type { Scope } from "./core.js";
import type { AddedFilters } from "./filter-seam.js";
import { notQuarantined } from "./quarantine.js";

/**
 * The listing walks a tenant's documents in date order and stops: it starts from the document's date index and reaches
 * the revision and the fence by key, so a page costs a page. The join is on the current event alone (both conditions
 * make the planner estimate one row and hash the table), and the order and date filters use the document's column,
 * the only one indexed. Both event joins stay: `documentFence()` names `e` and `ce`, which differ for historical revisions.
 */
export const listingJoinBase = (
  sql: Queryable,
) => sql`from source_document d join source_revision r on r.event_id = d.current_event_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id`;

/**
 * `lead_row` names the walked row under an alias nothing else uses, so a bound `leadsItsSeries` can re-declare `d`, `r`,
 * `e` and `ce` for the sibling it looks for and still compare it with this row. It reads nothing new.
 */
export const listingJoin = (sql: Queryable) => sql`${listingJoinBase(sql)}
  cross join lateral (select d.id, d.series_key, d.current_modified_at as modified_at) lead_row`;

/** A summary's columns; its app and when it happens by the build's expressions (`AddedFilters.app`, `occurrence`). */
export const summaryColumns = (
  sql: Queryable,
  s: Scope,
  shown: Pick<AddedFilters, "app" | "occurrence">,
) => sql`d.id, r.event_id as "versionId", ${displayApp(sql, shown.app)} as app,
  (select ${namedConnection(sql, s, "x")} from event_log x where x.id = d.current_event_id) as "connectionId",
  r.title, r.kind, r.author, r.location, r.url, r.modified_at as "sourceUpdatedAt",
  (select case when x.occurred_at = r.modified_at then x.occurred_precision end
    from event_log x where x.id = r.event_id) as "datePrecision",
  r.indexed_at as "indexedAt", r.metadata_status as "metadataStatus",
  d.origin_key as "originKey", d.org_id::text as "orgId",
  ${shown.occurrence?.at ?? sql`null`} as "occursAt", ${shown.occurrence?.held ?? sql`false`} as held,
  d.series_key as "seriesKey",
  coalesce(r.presentation #>> '{document,via}' = any(${[...GENERATED_VIAS]}::text[]), false) as generated,
  r.presentation #>> '{document,via}' as via, r.presentation #>> '{document,agent}' as "generatedAgent",
  r.presentation #>> '{document,onBehalfOf}' as "generatedOnBehalfOf",
  (select x.marker from injection_flag x
    where x.event_id = r.event_id and x.org_id = d.org_id) as "instructionMarker"`;

export const sourceJoin = (
  sql: Queryable,
) => sql`from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id`;

/** A document row is readable when both its cited version and its current version are, and neither is quarantined. */
export function documentFence(sql: Queryable, s: Scope, shape: ContainerSetShape = "any") {
  return sql`d.org_id = ${s.orgId} and e.org_id = ${s.orgId} and ce.org_id = ${s.orgId}
    and ${fenced(sql, s, { column: sql`e.container`, shape })} and ${fenced(sql, s, { column: sql`ce.container`, shape })}
    and ${notQuarantined(sql, "e")} and ${notQuarantined(sql, "ce")}`;
}
