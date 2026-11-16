/**
 * The keyword stage: one keyword entry per record, keyed by its event id, so a redelivery rewrites the same entry.
 * Best effort: a keyword service that is down or unconfigured costs the record its entry until the next rebuild
 * (`ingest.bm25.missed`), never the event's outcome, except under a durable owner, which retries.
 */

import type { Sql } from "postgres";
import { bm25GroupCommitOn } from "../kg/read/bm25.js";
import { appsOf, keywordDoc } from "../kg/read/bm25-doc.js";
import { passageContextMode, writesPassageContext } from "../kg/read/passage-context-mode.js";
import type { HeaderRecord } from "../memory/passage-context.js";
import { documentOfEntry } from "../sources/keyword-documents.js";
import { displayApp } from "../sources/read-core.js";
import { telemetry } from "../telemetry.js";
import { type Writes, writeHooksOf } from "../writes.js";
import { documentEntryOf, entryOfCurrent } from "./document-entry.js";
import { indexableEvent } from "./passage-rules.js";
import { bestEffort } from "./stage.js";

/** The record's keyword entry, written once (`keyword_indexed_at`) for a record that still stands. */
export async function indexKeywords(
  writes: Writes,
  ctx: { eventId: string; orgId: string; container: string; occurredAt: string },
  text: string,
  /** The record's header, as its own keyword field; none leaves the field empty until the record is next indexed. */
  header: string | null = null,
): Promise<void> {
  const { filters, passageRules, work, keyword } = writeHooksOf(writes);
  work.check();
  if (!keyword.endpoint.configured()) return;
  const { sql } = writes;
  const [event] =
    await sql`select keyword_indexed_at, connector, (select ${displayApp(sql, filters.app)} from source_revision r
    join source_document d on d.id = r.source_id where r.event_id = event_log.id) as app,
    (select r.title from source_revision r where r.event_id = event_log.id) as title
    from event_log where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableEvent(passageRules, sql)}`;
  if (!event || event.keyword_indexed_at) return;
  const apps = appsOf(event.connector, event.app);
  const entry = () => keywordDoc(ctx, { text, title: event.title, header, apps });
  await bestEffort("ingest.keyword", () => writeKeywordEntry(writes, ctx, entry()), {
    missed: missedKeyword,
    work,
  });
}

/**
 * The header the keyword index gets, only where the workspace's passage-context mode puts one on its passages: the
 * keyword service scores it as its own field, so a workspace set to `off` is never found through a header. A record
 * indexed before the switch keeps its header until it is next indexed.
 */
export async function keywordHeader(
  writes: Writes,
  orgId: string,
  record: HeaderRecord,
): Promise<string | null> {
  return writesPassageContext(await passageContextMode(writes.sql, orgId))
    ? writeHooksOf(writes).passageRules.recordHeader(record)
    : null;
}

/**
 * Index the entry durably, with its document's entry when it is the current revision (`keyword-documents.ts`), then
 * mark the event. A withdrawal can land between the read and the write and would leave the entry of a record that is
 * gone, so one probe after the write deletes it again when the event no longer stands, and its document's entry when
 * the document went with it; a document the withdrawal moved to another revision is written again by the withdrawal.
 */
async function writeKeywordEntry(
  writes: Writes,
  ctx: { eventId: string; orgId: string },
  entry: ReturnType<typeof keywordDoc>,
): Promise<void> {
  const { sql } = writes;
  const { passageRules: rules, work, keyword } = writeHooksOf(writes);
  const { endpoint } = keyword;
  const document = await documentEntryOf(writes, entry);
  const doc = document ? [entry, document] : [entry];
  // Durable before the marker: one group commit shared with whatever else waits, or, with group commit off, its own.
  if (bm25GroupCommitOn()) await endpoint.indexDurably(doc);
  else await endpoint.index(doc);
  const [still] = await sql`
      select 1 from event_log where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableEvent(rules, sql)}`;
  if (!still) {
    await endpoint.withdraw([
      ctx.eventId,
      ...(document && (await documentGone(sql, ctx.orgId, document.id)) ? [document.id] : []),
    ]);
    return;
  }
  await work.transaction(async (trx) => {
    await trx`update event_log set keyword_indexed_at = now()
        where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableEvent(rules, trx)}`;
  });
}

/** Whether the document behind this entry id no longer stands. */
async function documentGone(sql: Sql, orgId: string, entryId: string): Promise<boolean> {
  const [standing] = await sql`
    select 1 from source_document where org_id = ${orgId} and id = ${documentOfEntry(entryId)}
      and current_event_id is not null`;
  return !standing;
}

/** A keyword entry not written: reported and counted, never the record's failure. */
/**
 * A current revision with nothing to index leaves its document no entry, rather than the last revision's text (best
 * effort, as `indexKeywords`).
 */
export async function forgetDocumentEntry(writes: Writes, eventId: string): Promise<void> {
  if (!writeHooksOf(writes).keyword.endpoint.configured()) return;
  await bestEffort("ingest.keyword", () => deleteCurrentEntry(writes, eventId), {
    missed: missedKeyword,
    work: writeHooksOf(writes).work,
  });
}

async function deleteCurrentEntry(writes: Writes, eventId: string): Promise<void> {
  const entry = await entryOfCurrent(writes, eventId);
  if (entry) await writeHooksOf(writes).keyword.endpoint.withdraw([entry]);
}

function missedKeyword(err: unknown): void {
  telemetry.error("ingest.bm25", err, {});
  telemetry.count("ingest.bm25.missed", 1, {});
}
