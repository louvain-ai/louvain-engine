import { type GeneratedBy, type SourceSummary, safeSourceUrl } from "@louvain/engine-core";
import { opaqueOrigin, opaqueSeries } from "../../store/opaque-ids.js";
import { fence, type ReadContext, type Reader, readsNothing } from "../fence.js";
import { displayAuthor } from "../originals/metadata.js";
import type { Byline } from "./detail-seam.js";

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
