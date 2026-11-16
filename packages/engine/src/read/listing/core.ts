import {
  GENERATED_VIAS,
  type GeneratedBy,
  type SourceSummary,
  safeSourceUrl,
} from "@louvain/engine-core";
import { singleAppByConnector } from "../../store/apps.js";
import { opaqueOrigin, opaqueSeries } from "../../store/opaque-ids.js";
import type { Queryable } from "../../store/sql.js";
import {
  type ContainerSetShape,
  fence,
  fenced,
  type ReadContext,
  type Reader,
  readsNothing,
} from "../fence.js";
import { displayAuthor } from "../originals/metadata.js";
import type { Byline } from "./detail-seam.js";
import type { AddedFilters, ShownApp } from "./filter-seam.js";
import { notQuarantined } from "./quarantine.js";

/**
 * What every source read shares: the reader's scope, the row, the fence and the summary. Each fragment is written with
 * the handle of the read it serves (`sql`).
 */
export type Owner = { orgId: string; principal: string };
export type Scope = Reader & {
  /**
   * EVERY current document the reader's containers hold, when that is a small set (`reachOf`, `read/listing/bounds.ts`):
   * the listing is narrowed to these ids instead of walking the tenant's date index. A narrowing, never the fence —
   * `documentFence()` still decides every row.
   */
  reach?: readonly string[];
};
export type SourceRow = Omit<
  SourceSummary,
  | "sourceUpdatedAt"
  | "indexedAt"
  | "origin"
  | "generated"
  | "generatedBy"
  | "connectionId"
  | "instructionLike"
  | "series"
  | "occursAt"
  | "held"
  | "datePrecision"
> & {
  generated: boolean;
  /** The marker `injection_flag` holds for this version, or null. */
  instructionMarker: string | null;
  /** The current revision's feed; null where it was never recorded. */
  connectionId: string | null;
  /** Who wrote a generated item, for its byline (`DetailHooks.byline`): the version's via, agent and person. */
  via: string | null;
  generatedAgent: string | null;
  generatedOnBehalfOf: string | null;
  sourceUpdatedAt: Date;
  indexedAt: Date;
  /** The document's own key; the summary carries its opaque form. */
  originKey: string | null;
  orgId: string;
  /** When the item happens, as stored text, by the build's expression (`AddedFilters.occurrence`); else null. */
  occursAt: string | null;
  held: boolean;
  /** How much of the matched version's date its source knew (`event_log.occurred_precision`); null is an instant. */
  datePrecision: SourceSummary["datePrecision"] | null;
  /** The series the build's writer keyed the document's current revision with; the summary carries its opaque form. */
  seriesKey: string | null;
};
/**
 * The app a source shows as, by the build's expression (`AddedFilters.app`, handed by the read); else the service its
 * presentation names, else the ONE app its connector declares (`connector-apps.ts`), else the connector itself. Read
 * at query time, so a connector's variant is filed under its app in a listing and an app filter, stored records too.
 */
const ownApp = (sql: Queryable) => sql`coalesce(r.presentation->>'service',
  coalesce(${sql.json(singleAppByConnector())}::jsonb ->> d.connector, d.connector))`;
export const displayApp = (sql: Queryable, app: ShownApp | null) => app?.shown() ?? ownApp(sql);
/** The app as a filter or a facet reads it: the build's expression's, else the one a row shows. */
export const filterApp = (sql: Queryable, app: ShownApp | null) =>
  app?.filtered() ?? displayApp(sql, app);
/**
 * The connection a source came through, as this viewer may name it: an id a client names a source by, and a facet
 * groups by. A container filed under another (`container_parent`) may be read without its parent, and its reader must
 * not learn the parent through the connection: where this viewer does NOT read the parent, there is no connection to
 * name (null, grouped with none). A reader of the parent sees the connection.
 */
export function namedConnection(sql: Queryable, s: Scope, event: string) {
  const x = sql(event);
  return sql`case when exists (
      select 1 from container_parent cp
      where cp.org_id = ${x}.org_id and cp.child = ${x}.container and not (${fenced(sql, s, sql`cp.parent`, { shape: "any" })})
    ) then null else ${x}.connection_id::text end`;
}
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
    and ${fenced(sql, s, sql`e.container`, { shape })} and ${fenced(sql, s, sql`ce.container`, { shape })}
    and ${notQuarantined(sql, "e")} and ${notQuarantined(sql, "ce")}`;
}
/** The reader's scope from their fence (`fence`): the reader that reads nothing where the fence is null. */
export async function scope(context: ReadContext, owner: Owner): Promise<Scope> {
  return (await fence(context, owner)) ?? readsNothing(owner.orgId);
}
/** An agent's item names the agent and the person it wrote for, wherever an author is shown, by the build's byline. */
function generatedByline(row: SourceRow, byline: Byline): { generatedBy?: GeneratedBy } {
  const by = byline({
    via: row.via,
    agent: row.generatedAgent,
    onBehalfOf: row.generatedOnBehalfOf,
  });
  return by ? { generatedBy: by } : {};
}

/** `SourceSummary.series`: the document's series key in its opaque form, or nothing. */
function seriesOf(row: Pick<SourceRow, "orgId" | "seriesKey">): { series?: string } {
  return row.seriesKey ? { series: opaqueSeries(row.orgId, row.seriesKey) } : {};
}

/** When the item happens and whether it took place, as the build reads them; nothing for anything else. */
function occurrenceOf(row: Pick<SourceRow, "occursAt" | "held">): {
  occursAt?: string;
  held?: true;
} {
  const at = row.occursAt ? Date.parse(row.occursAt) : Number.NaN;
  return {
    ...(Number.isFinite(at) ? { occursAt: new Date(at).toISOString() } : {}),
    ...(row.held ? { held: true as const } : {}),
  };
}

/** A row as its summary; a generated document's writer named by the build's `byline` (`ReadHooks.detail`). */
export function summary(row: SourceRow, byline: Byline): SourceSummary {
  return {
    id: row.id,
    versionId: row.versionId,
    app: row.app,
    title: row.title,
    kind: row.kind,
    author: displayAuthor(row.author),
    location: row.location,
    metadataStatus: row.metadataStatus,
    url: safeSourceUrl(row.url),
    sourceUpdatedAt: new Date(row.sourceUpdatedAt).toISOString(),
    ...(row.datePrecision ? { datePrecision: row.datePrecision } : {}),
    indexedAt: new Date(row.indexedAt).toISOString(),
    ...(row.originKey ? { origin: opaqueOrigin(row.orgId, row.originKey) } : {}),
    ...seriesOf(row),
    ...occurrenceOf(row),
    ...(row.connectionId ? { connectionId: row.connectionId } : {}),
    ...(row.generated ? { generated: true as const, ...generatedByline(row, byline) } : {}),
    // Instruction-like text in this version — every reader quotes it and never follows it.
    ...(row.instructionMarker ? { instructionLike: { marker: row.instructionMarker } } : {}),
  };
}
