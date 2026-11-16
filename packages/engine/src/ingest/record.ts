/**
 * The record stage: the stored record an index works from, read again by its id, so every indexer (the loader, a
 * queue's job) indexes what is stored and nothing it was handed. A record that is not indexable content, has no text
 * or is past the cap is nothing to index.
 */
import { CONTENT_EVENT_KINDS, MAX_ITEM_TEXT_CHARS } from "@louvain/engine-core";
import type { Sql } from "postgres";
import { config } from "../config/engine.js";
import type { HeaderDocument } from "./passage-context.js";
import { type PlannedContext, plannedContexts } from "./passage-context-write.js";
import { indexableRevision } from "./passage-rules.js";
import type { MemoryWriteContext } from "./passages.js";
import { type Writes, writeHooksOf } from "./writes.js";

/** A record to index: where its passages go, its text and header, and the context each chunk is written with. */
export type IndexedRevision = {
  ctx: MemoryWriteContext;
  header: HeaderDocument;
  planned: PlannedContext[] | null;
};

/** The stored record `eventId` names, ready to index, or null when there is nothing to index. */
export async function revisionToIndex(
  writes: Writes,
  eventId: string,
): Promise<IndexedRevision | null> {
  const { sql } = writes;
  const [row] = await sql`
    select id, workspace, container, connector, occurred_at, actor_id, body, org_id, actor_relays
    from event_log where id = ${eventId} ${indexableRevision(writeHooksOf(writes).passageRules, sql)}
      and kind = any(${[...CONTENT_EVENT_KINDS]}::text[])`;
  if (!row) return null;
  const text = (row.body as { text?: string }).text;
  if (!text || oversize(text)) return null;
  const ctx = {
    eventId: row.id as string,
    orgId: row.org_id as string,
    workspace: row.workspace as string,
    container: row.container as string,
    author: row.actor_id as string,
    occurredAt: new Date(row.occurred_at as string).toISOString(),
    relays: row.actor_relays === true,
  };
  const header = await headerRecordOf(sql, ctx, row, text);
  // Each new row carries its header context from the insert; with `config.passageWriteOnce` off, contexts come after.
  const planned = !config.passageWriteOnce
    ? null
    : await plannedContexts(writes, ctx.orgId, header);
  return { ctx, header, planned };
}

/** A body past the cap is never indexed: it would be chunked, embedded and read whole. */
export function oversize(text: string): boolean {
  return text.length > MAX_ITEM_TEXT_CHARS;
}

/**
 * What a header may be built from, for this event and nothing else: the row the indexer already read (its text,
 * presentation and connector) and the event's own listing row (`source_revision`, keyed by the event id: its title,
 * type, author and location) with its valid time. One primary-key read; a record not listed yet is headed from its
 * presentation alone.
 */
async function headerRecordOf(
  sql: Sql,
  memCtx: { eventId: string; orgId: string; occurredAt: string },
  row: Record<string, unknown>,
  text: string,
): Promise<HeaderDocument> {
  const body = row.body as { presentation?: unknown } | null;
  const presentation =
    body?.presentation && typeof body.presentation === "object" && !Array.isArray(body.presentation)
      ? (body.presentation as Record<string, unknown>)
      : {};
  const [listed] = await sql<
    { kind: string | null; title: string | null; author: string | null; location: string | null }[]
  >`select r.kind, r.title, r.author, r.location from source_revision r
      join event_log e on e.id = r.event_id and e.org_id = ${memCtx.orgId}
     where r.event_id = ${memCtx.eventId}`;
  return {
    text,
    presentation,
    connector: typeof row.connector === "string" ? row.connector : "",
    meta: { ...(listed ?? {}), occurredAt: memCtx.occurredAt },
  };
}
