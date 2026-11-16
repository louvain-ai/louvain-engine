/**
 * The keyword stage: one keyword entry per record, keyed by its event id, so a redelivery rewrites the same entry.
 * Best effort: a keyword service that is down or unconfigured costs the record its entry until the next rebuild
 * (`ingest.bm25.missed`), never the event's outcome, except under a durable owner, which retries.
 */

import type { Sql } from "postgres";
import { telemetry } from "../observability/telemetry.js";
import { displayApp } from "../read/listing/core.js";
import { documentOfEntry } from "../read/listing/keyword-documents.js";
import { passageContextMode, writesPassageContext } from "../store/context-mode.js";
import { appsOf, type Bm25Doc, keywordDoc } from "../store/keyword-document.js";
import { bm25GroupCommitOn } from "../store/keyword-index.js";
import { documentEntryOf, entryOfCurrent } from "./document-entry.js";
import type { HeaderDocument } from "./passage-context.js";
import { indexableRevision } from "./passage-rules.js";
import { bestEffort, stage } from "./stage.js";
import { inOneTransaction, type Writes, writeHooksOf } from "./writes.js";

type Entry = { ctx: { eventId: string; orgId: string }; entry: Bm25Doc };

/** One record's keyword input: its event, its text and its header (its own keyword field; none leaves it empty). */
export type KeywordRecord = {
  ctx: { eventId: string; orgId: string; container: string; occurredAt: string };
  text: string;
  header: string | null;
};

/**
 * The records' keyword entries, each written once (`keyword_indexed_at`) for a record that still stands, in ONE durable
 * write: every entry added, one commit, then each record's marker. A batch that fails is taken again a record at a
 * time, the batch of one being the write as it always was, so a record's outcome never depends on its neighbours'.
 */
export async function indexKeywords(
  writes: Writes,
  records: readonly KeywordRecord[],
): Promise<void> {
  const { work, keyword } = writeHooksOf(writes);
  work.check();
  if (!keyword.endpoint.configured()) return;
  const entries: Entry[] = [];
  for (const record of records) {
    const entry = await entryToWrite(writes, record);
    if (entry) entries.push({ ctx: record.ctx, entry });
  }
  if (entries.length === 0) return;
  if (entries.length === 1 || records.length === 1) {
    for (const { ctx, entry } of entries)
      await bestEffort("ingest.keyword", () => writeKeywordEntries(writes, [{ ctx, entry }]), {
        missed: missedKeyword,
        work,
      });
    return;
  }
  try {
    await stage("ingest.keyword", () => writeKeywordEntries(writes, entries));
  } catch {
    // swallowed: the batch is taken again a record at a time, each counted or thrown on as it always was.
    for (const record of records) await indexKeywords(writes, [record]);
  }
}

/** The record's entry, or null: a record that no longer stands, or one already in the index. */
async function entryToWrite(writes: Writes, { ctx, text, header }: KeywordRecord) {
  const { filters, passageRules } = writeHooksOf(writes);
  const { sql } = writes;
  const [event] =
    await sql`select keyword_indexed_at, connector, (select ${displayApp(sql, filters.app)} from source_revision r
    join source_document d on d.id = r.source_id where r.event_id = event_log.id) as app,
    (select r.title from source_revision r where r.event_id = event_log.id) as title
    from event_log where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableRevision(passageRules, sql)}`;
  if (!event || event.keyword_indexed_at) return null;
  const apps = appsOf(event.connector, event.app);
  return keywordDoc(ctx, { text, title: event.title, header, apps });
}

/**
 * The header the keyword index gets, only where the workspace's passage-context mode puts one on its passages: the
 * keyword service scores it as its own field, so a workspace set to `off` is never found through a header. A record
 * indexed before the switch keeps its header until it is next indexed.
 */
export async function keywordHeader(
  writes: Writes,
  orgId: string,
  record: HeaderDocument,
): Promise<string | null> {
  return writesPassageContext(await passageContextMode(writes.sql, orgId))
    ? writeHooksOf(writes).passageRules.documentHeader(record)
    : null;
}

/**
 * Index the entries durably, each with its document's entry when it is the current revision (`keyword-documents.ts`),
 * in one write and one commit, then mark each event. A withdrawal can land between the read and the write and would
 * leave the entry of a record that is gone, so one probe after the write deletes it again when the event no longer
 * stands, and its document's entry when the document went with it; a document the withdrawal moved to another revision
 * is written again by the withdrawal.
 */
async function writeKeywordEntries(writes: Writes, entries: readonly Entry[]): Promise<void> {
  const { endpoint } = writeHooksOf(writes).keyword;
  const written: { ctx: Entry["ctx"]; document: Bm25Doc | null }[] = [];
  for (const { ctx, entry } of entries)
    written.push({ ctx, document: await documentEntryOf(writes, entry) });
  const docs = entries.flatMap(({ entry }, i) => [
    entry,
    ...(written[i]?.document ? [written[i].document] : []),
  ]);
  // Durable before the markers: one group commit shared with whatever else waits, or, with group commit off, its own.
  if (bm25GroupCommitOn()) await endpoint.indexDurably(docs);
  else await endpoint.index(docs);
  await inOneTransaction(writes, async (batch) => {
    for (const { ctx, document } of written) await markOrWithdraw(batch, ctx, document);
  });
}

/** The event's marker, or, for one withdrawn while its entry was written, the entry deleted again. */
async function markOrWithdraw(
  writes: Writes,
  ctx: { eventId: string; orgId: string },
  document: Bm25Doc | null,
): Promise<void> {
  const { sql } = writes;
  const { passageRules: rules, work, keyword } = writeHooksOf(writes);
  const [still] = await sql`
      select 1 from event_log where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableRevision(rules, sql)}`;
  if (!still) {
    await keyword.endpoint.withdraw([
      ctx.eventId,
      ...(document && (await documentGone(sql, ctx.orgId, document.id)) ? [document.id] : []),
    ]);
    return;
  }
  await work.transaction(async (trx) => {
    await trx`update event_log set keyword_indexed_at = now()
        where id = ${ctx.eventId} and org_id = ${ctx.orgId} ${indexableRevision(rules, trx)}`;
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
