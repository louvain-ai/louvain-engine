/**
 * The rest of a row: how long the source behind each row is (`sourceExtents`) and the whole of it (`readSource`), for
 * a row a reader has already been shown as an excerpt. The fence is restated in SQL on every read, because the row is
 * chosen by a model that has just read hostile text: org, readable collections, the as-of instant, and the selection
 * a caller pins. Each is a bounded read on the caller's context (`bounded`).
 */

import { bounded } from "../bounded.js";
import type { ReadContext } from "../fence.js";
import { notQuarantined } from "../listing/quarantine.js";

/** How long a source's own text is, whether it was cut at import, and the format its reader named (`xlsx`…). */
export type SourceExtent = { chars: number; ingest: boolean; format?: string | null };

/** How long each source's own text is, for rows already on the page. Lengths only — no text crosses. */
export async function sourceExtents(
  context: ReadContext,
  args: {
    orgId: string;
    containers: string[];
    eventIds: string[];
    at: string;
  },
): Promise<Map<string, SourceExtent>> {
  if (args.eventIds.length === 0 || args.containers.length === 0) return new Map();
  const rows = await bounded(
    context,
    (q) => q<{ id: string; chars: number | null; ingest: boolean; format: string | null }[]>`
      select e.id, length(e.body->>'text') as chars, e.body #>> '{presentation,document,format}' as format,
             coalesce(r.presentation->'document'->>'truncated', 'false') = 'true' as ingest
      from event_log e left join source_revision r on r.event_id = e.id
      where e.org_id = ${args.orgId} and e.id = any(${args.eventIds}::text[])
        and e.container = any(${args.containers}) and e.occurred_at <= ${args.at}
        and ${notQuarantined(q, "e")}`,
  );
  return new Map(
    rows.map((r) => [r.id, { chars: r.chars ?? 0, ingest: r.ingest, format: r.format }]),
  );
}

export type SourceText = {
  text: string;
  ingest: boolean;
  /** The source's first passage, so a row that is not a passage can be replaced by one that is citable. */
  passageId: string | null;
  /** The file's format as its reader named it (`presentation.document.format`: `xlsx`, `pdf`…); null for anything else. */
  format: string | null;
};

/** The whole text of one row's source, fenced again. Null when it is not readable. */
export async function readSource(
  context: ReadContext,
  args: {
    orgId: string;
    containers: string[];
    eventId: string;
    at: string;
    /** A selection the caller pins: the read must stay inside it. Null for none. */
    selection: string[] | null;
  },
): Promise<SourceText | null> {
  if (args.containers.length === 0) return null;
  if (args.selection && !args.selection.includes(args.eventId)) return null;
  const [row] = await bounded(
    context,
    (q) => q<
      { text: string | null; ingest: boolean; passage_id: string | null; format: string | null }[]
    >`
      select e.body->>'text' as text, e.body #>> '{presentation,document,format}' as format,
             coalesce(r.presentation->'document'->>'truncated', 'false') = 'true' as ingest,
             (select p.id::text from passage p
               where p.org_id = e.org_id and p.event_id = e.id and p.container = e.container
               order by p.seq limit 1) as passage_id
      from event_log e left join source_revision r on r.event_id = e.id
      where e.org_id = ${args.orgId} and e.id = ${args.eventId}
        and e.container = any(${args.containers}) and e.occurred_at <= ${args.at}
        and ${notQuarantined(q, "e")}`,
  );
  if (!row?.text) return null;
  return { text: row.text, ingest: row.ingest, passageId: row.passage_id, format: row.format };
}
