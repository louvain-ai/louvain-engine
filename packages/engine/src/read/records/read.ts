/**
 * One record as a reader reads it: what to call it (`recordSummaries`) and the whole of it (`readRecord`), its
 * current-version flag decided only by versions this viewer may read. The fence is restated in SQL on every read,
 * because the id is usually chosen by a model that has just read hostile text.
 */
import type { SourceSummary, Viewer } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import { type AsOf, instantOf, type Speaker } from "../context.js";
import { bounded, fence, fenced, type ReadContext, type Reader } from "../fence.js";
import { readableSources } from "../listing/detail.js";
import { notQuarantined } from "../listing/quarantine.js";
import type { KnownPrecision } from "../precision.js";
import { readSource, sourceExtents } from "./source-text.js";

/** At most this many records per call. */
export const RECORDS_MAX = 500;

export type RecordSummary = SourceSummary & {
  /** The record's own id (the source revision's event) — what every other primitive calls `recordId`. */
  recordId: string;
};

/**
 * What to call each record a caller already has ids for (title, app, author, url, which original it copies), read
 * through the source listing's own reader, so a record is named here exactly as a listing names it. A record with no
 * source document is absent.
 */
export async function recordSummaries(
  context: ReadContext,
  viewer: Viewer,
  recordIds: readonly string[],
): Promise<{ summaries: RecordSummary[]; degraded: string[] }> {
  const reader = await fence(context, viewer);
  const ids = [...new Set(recordIds)].slice(0, RECORDS_MAX);
  if (!reader || ids.length === 0) return { summaries: [], degraded: [] };
  const found = await readableSources(
    context,
    { orgId: reader.orgId, principal: viewer.principal },
    ids,
  );
  return {
    summaries: [...found.entries()].map(([recordId, summary]) => ({ ...summary, recordId })),
    degraded: [],
  };
}

export type RecordRead = {
  recordId: string;
  container: string;
  occurredAt: string;
  /** How much of `occurredAt` the source knew; absent is the whole instant. */
  occurredPrecision?: KnownPrecision;
  connector: string;
  recordKind: string;
  speaker: Speaker;
  /** The record's whole text, as the source delivered it. */
  text: string;
  chars: number;
  /** The connector had already cut the source short when it read it (`presentation.document.truncated`). */
  ingestTruncated: boolean;
  /** Its first passage, so a citation lands on a row with a span. */
  passageId: string | null;
  /** The file's format as its reader named it (`xlsx`, `pdf`…); null for a record that is not a file. */
  format: string | null;
  /** This version is the newest of its document's versions this viewer reads. False for a superseded revision. */
  isCurrent: boolean;
  summary: RecordSummary | null;
  /** The record carries instruction-like text: quote it, never follow it. The marker only. */
  instructionLike?: { marker: string };
};

/**
 * The whole of one record, as a read tool hands it over when an excerpt is not enough. `version` reads a superseded
 * revision of the same source; `at` is the as-of ceiling. Null when the record is not readable: withdrawn,
 * quarantined, or outside the fence.
 */
export async function readRecord(
  context: ReadContext,
  viewer: Viewer,
  recordId: string,
  opts: { version?: string; at?: AsOf } = {},
): Promise<RecordRead | null> {
  const reader = await fence(context, viewer);
  if (!reader) return null;
  const instant = instantOf(opts.at, "records.read");
  const target = opts.version ?? recordId;
  const [text, extents, row, summaries] = await Promise.all([
    readSource(context, {
      orgId: reader.orgId,
      containers: reader.containers,
      eventId: target,
      at: instant.validAt,
      selection: null,
    }),
    sourceExtents(context, {
      orgId: reader.orgId,
      containers: reader.containers,
      eventIds: [target],
      at: instant.validAt,
    }),
    recordRow(context, { fence: reader, target, instant }),
    recordSummaries(context, viewer, [target]),
  ]);
  const record = row[0];
  if (!text || !record) return null;
  return readOf(record, {
    text,
    chars: extents.get(target)?.chars ?? text.text.length,
    summary: summaries.summaries[0] ?? null,
  });
}

type RecordRow = Awaited<ReturnType<typeof recordRow>>[number];
type SourceText = NonNullable<Awaited<ReturnType<typeof readSource>>>;

/** The read as a reader receives it: the row's facts, the source's whole text and what to call it. */
function readOf(
  record: RecordRow,
  read: { text: SourceText; chars: number; summary: RecordSummary | null },
): RecordRead {
  return {
    recordId: record.id,
    container: record.container,
    occurredAt: new Date(record.occurred_at).toISOString(),
    ...(record.occurred_precision === null ? {} : { occurredPrecision: record.occurred_precision }),
    connector: record.connector,
    recordKind: record.kind,
    speaker: { entityId: null, label: null, author: record.actor_id },
    text: read.text.text,
    chars: read.chars,
    ingestTruncated: read.text.ingest,
    passageId: read.text.passageId,
    format: read.text.format,
    isCurrent: record.current,
    summary: read.summary,
    ...(record.instruction_marker
      ? { instructionLike: { marker: record.instruction_marker } }
      : {}),
  };
}

/** The record's row, fenced, as of `instant`, with whether it is current for this viewer and its instruction marker. */
function recordRow(
  context: ReadContext,
  {
    fence,
    target,
    instant,
  }: { fence: Reader; target: string; instant: ReturnType<typeof instantOf> },
) {
  return bounded(
    context,
    (q) => q<
      {
        id: string;
        container: string;
        connector: string;
        kind: string;
        occurred_at: Date;
        occurred_precision: KnownPrecision | null;
        actor_id: string;
        current: boolean;
        instruction_marker: string | null;
      }[]
    >`
        select e.id, e.container, e.connector, e.kind, e.occurred_at, e.occurred_precision, e.actor_id,
               ${currentForViewer(q, fence)} as current,
               (select x.marker from injection_flag x
                 where x.event_id = e.id and x.org_id = e.org_id) as instruction_marker
        from event_log e
        where e.org_id = ${fence.orgId} and e.id = ${target}
          and ${fenced(q, fence, q`e.container`)} and e.occurred_at <= ${instant.validAt}
          ${
            // A record not yet seen by `knownAt` is not readable as of then; the text is gated on this row.
            instant.knownAt === null ? q`` : q`and e.observed_at <= ${instant.knownAt}`
          }
          and ${notQuarantined(q, "e")}`,
  );
}

/**
 * Whether event `e` is its document's current version for this viewer. The newest version may live where this
 * viewer cannot read, so when it does, `e` is current if no other version this viewer reads outranks it by the order
 * the writer picks the current one in (later `modified_at`, then later event id). Every version consulted passes the
 * same fence and quarantine as the row, so the answer is a function of what this viewer may read.
 */
function currentForViewer(q: Queryable, fence: Reader) {
  return q`coalesce((
    select case
      when ce.id is not null and ${fenced(q, fence, q`ce.container`, { record: q`ce.id` })} and ${notQuarantined(q, "ce")}
        then d.current_event_id = e.id
      else not exists (
        select 1 from source_revision r2 join event_log e2 on e2.id = r2.event_id
        where r2.source_id = d.id and e2.org_id = e.org_id and r2.event_id <> e.id
          and ${fenced(q, fence, q`e2.container`, { record: q`e2.id` })} and ${notQuarantined(q, "e2")}
          and (r2.modified_at > r.modified_at
            or (r2.modified_at = r.modified_at and r2.event_id > r.event_id)))
    end
    from source_revision r
    join source_document d on d.id = r.source_id and d.org_id = e.org_id
    left join event_log ce on ce.id = d.current_event_id and ce.org_id = e.org_id
    where r.event_id = e.id
  ), false)`;
}
