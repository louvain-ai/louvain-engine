/**
 * The records in a window, and how many there are, without walking every record: the page walks in its own order and
 * stops, and the count stops one row past the cap and says "at least". Both are bounded reads. Content records only,
 * never a quarantined one, newest first; `before` continues a page from its last record. The page picks its ids first
 * and reads the bodies of those rows only, so a wide reader's page costs a page, not their readable rows.
 */

import { CONTENT_EVENT_KINDS, type Viewer } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import { bounded } from "../bounded.js";
import type { Evidence } from "../context.js";
import { fence, type ReadContext, type Reader } from "../fence.js";
import { fenced } from "../fenced.js";
import { type DocumentFilters, documentPredicates } from "../filters.js";
import { agentWritten, instructionLikeRevisions, labelOf, referenceRead } from "../generated.js";
import { hooksOf } from "../hooks.js";
import { boundedTotal } from "../listing/bounds.js";
import { COUNT_LIMIT } from "../listing/limits.js";
import { notQuarantined } from "../listing/quarantine.js";
import { originsFor } from "../originals/reads.js";
import type { KnownPrecision } from "../precision.js";

export type RevisionWindowFilters = Omit<DocumentFilters, "apps"> & {
  kinds?: ("message" | "file" | "record.change")[];
  /** Narrows to these containers — intersected with the readable set, never added to it. */
  containers?: string[];
  limit?: number;
  /** The last record of the previous page. */
  before?: { occurredAt: string; recordId: string };
  /** How much of each record's text to return. Default 2,000 characters. */
  textChars?: number;
};

export type RevisionHit = Evidence & {
  kind: "record";
  connector: string;
  recordKind: string;
  /** The record's text is longer than `text`. */
  clipped: boolean;
  /** The whole text's length in characters, so a reader can say how much of it `text` shows. */
  length: number;
};

export type RevisionWindow = {
  records: RevisionHit[];
  /** Exact when `bounded` is false; otherwise the cap, and there are at least this many. */
  count: number;
  bounded: boolean;
  next: { occurredAt: string; recordId: string } | null;
};

type Row = {
  id: string;
  container: string;
  connector: string;
  kind: string;
  occurred_at: Date;
  occurred_precision: KnownPrecision | null;
  actor_id: string;
  text: string | null;
  length: number | null;
};

/** The records in a window for this viewer, a bounded count of them, and the cursor for the next page. */
export async function revisionWindow(
  context: ReadContext,
  viewer: Viewer,
  filters: RevisionWindowFilters = {},
): Promise<RevisionWindow> {
  const none: RevisionWindow = { records: [], count: 0, bounded: false, next: null };
  const scope = await fence(context, viewer, filters.containers);
  if (!scope) return none;
  const limit = Math.min(Math.max(1, filters.limit ?? 50), 500);
  const chars = Math.min(Math.max(0, filters.textChars ?? 2_000), 100_000);
  const [rows, counted] = await windowReads(context, { scope, filters, limit, chars });
  const { total, totalBounded } = boundedTotal(counted[0]?.count ?? 0);
  const records = await windowHits(context, scope, rows);
  const last = records[records.length - 1];
  return {
    records,
    count: total,
    bounded: totalBounded,
    next:
      rows.length === limit && last
        ? { occurredAt: last.occurredAt, recordId: last.recordId }
        : null,
  };
}

type WindowRead = { scope: Reader; filters: RevisionWindowFilters; limit: number; chars: number };

/**
 * The page and its bounded count, side by side. The page reads its ids first, then the bodies of those rows only:
 * the walk reads no text, so a page past a wide reader's thousands of rows reads `limit` bodies, not all of them.
 */
function windowReads(context: ReadContext, { scope, filters, limit, chars }: WindowRead) {
  const kinds =
    filters.kinds && filters.kinds.length > 0 ? filters.kinds : [...CONTENT_EVENT_KINDS];
  const where = (q: Queryable) => q`
    e.org_id = ${scope.orgId} and ${fenced(q, scope, q`e.container`)}
    and e.kind = any(${kinds}::text[]) and ${notQuarantined(q, "e")}
    ${documentPredicates(q, { added: hooksOf(context).filters, orgId: scope.orgId, filters })}`;
  return Promise.all([
    bounded(
      context,
      (q) => q<Row[]>`
        select e.id, e.container, e.connector, e.kind, e.occurred_at, e.occurred_precision, e.actor_id,
               left(e.body->>'text', ${chars}) as text, length(e.body->>'text') as length
        from (
          select e.id from event_log e
          where ${where(q)}
            ${
              filters.before
                ? q`and (e.occurred_at, e.id) < (${filters.before.occurredAt}::timestamptz, ${filters.before.recordId})`
                : q``
            }
          order by e.occurred_at desc, e.id desc
          limit ${limit}) page
        join event_log e on e.id = page.id and e.org_id = ${scope.orgId}
        order by e.occurred_at desc, e.id desc`,
    ),
    bounded(
      context,
      (q) => q<{ count: number }[]>`
        select count(*)::int as count from (
          select 1 from event_log e where ${where(q)} limit ${COUNT_LIMIT}) t`,
    ),
  ]);
}

/**
 * Each row as a hit, with its origin, whether an agent wrote it, whether it is read as reference, and its
 * instruction-like label, read in parallel. None can empty the page: an origin is presentation (lost, it costs only
 * the grouping), and the agent and reference reads fail closed to "generated" and "reference".
 */
async function windowHits(
  context: ReadContext,
  fence: Reader,
  rows: Row[],
): Promise<RevisionHit[]> {
  const { sql } = context;
  const ids = rows.map((r) => r.id);
  const [origins, generated, reference, instructionLike] = await Promise.all([
    originsFor(sql, fence.orgId, ids).catch(() => {
      // swallowed: an origin is presentation and never a fence input; losing it costs the grouping, never the page.
      return new Map<string, string>();
    }),
    agentWritten(sql, fence.orgId, ids),
    referenceRead(sql, hooksOf(context).reading, { orgId: fence.orgId, ids }),
    instructionLikeRevisions(sql, fence.orgId, ids),
  ]);
  return rows.map((r): RevisionHit => {
    const text = r.text ?? "";
    const origin = origins.get(r.id);
    return {
      kind: "record",
      recordId: r.id,
      span: text.length > 0 ? { start: 0, end: text.length } : null,
      speaker: { entityId: null, label: null, author: r.actor_id },
      occurredAt: new Date(r.occurred_at).toISOString(),
      ...(r.occurred_precision === null ? {} : { occurredPrecision: r.occurred_precision }),
      container: r.container,
      text,
      entityIds: [],
      ...(origin === undefined ? {} : { origin }),
      ...(generated.has(r.id) ? { generated: true as const } : {}),
      ...(reference.has(r.id) ? { reading: "reference" as const } : {}),
      ...labelOf(instructionLike, r.id),
      connector: r.connector,
      recordKind: r.kind,
      clipped: (r.length ?? 0) > text.length,
      length: r.length ?? text.length,
    };
  });
}
