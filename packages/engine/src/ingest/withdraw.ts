import type { Sql, TransactionSql } from "postgres";
import { documentEntryId } from "../read/listing/keyword-documents.js";
import { documentLockName } from "./event-row.js";
import { indexOpen } from "./indexer.js";
import { dropRevisionless, repointDocuments } from "./repair.js";
import { type Writes, writeHooksOf } from "./writes.js";

/**
 * Records withdrawn from every tier the engine writes, by the shared withdrawal steps in their order: vectors, the
 * event rows (their passages and revisions go with them), the repair of their documents, then the keyword index after
 * the commit: the records' entries deleted, and the document entries of the documents whose current revision went
 * written again from the revision now current, or deleted with the document (`refreshDocuments`). A keyword entry left
 * behind is never read: every hit is read again from the store, where the record no longer is.
 */
export type OpenWithdrawn = { events: number; keywordMissed: number };

type Withdrawable = { id: string; connector: string; workspace: string; recordKey: string | null };

export async function withdrawOpen(
  writes: Writes,
  orgId: string,
  events: readonly Withdrawable[],
): Promise<OpenWithdrawn> {
  const ids = [...new Set(events.map((e) => e.id))];
  if (ids.length === 0) return { events: 0, keywordMissed: 0 };
  const withdrawn = await writes.sql.begin((trx) => withdrawWithin(trx, orgId, events));
  const missed = await forgetKeywords(writes, ids);
  return {
    events: withdrawn.events,
    keywordMissed: missed + (await refreshDocuments(writes, orgId, withdrawn.documents)),
  };
}

/** What a withdrawal took: the event rows, and the documents whose current revision it took (`refreshDocuments`). */
type Withdrawal = { events: number; documents: string[] };

/**
 * The same withdrawal inside a caller's transaction, so it commits or rolls back with what the caller writes beside
 * it; once that transaction has committed, the caller deletes the keyword entries (`forgetKeywords`) and refreshes the
 * documents' (`refreshDocuments`).
 */
export async function withdrawWithin(
  trx: TransactionSql,
  orgId: string,
  events: readonly Withdrawable[],
): Promise<Withdrawal> {
  const ids = [...new Set(events.map((e) => e.id))];
  if (ids.length === 0) return { events: 0, documents: [] };
  // The accept path takes the same locks, so an arrival of one of these records cannot slip in between.
  await lockRecords(trx, orgId, events);
  return withdrawRows(trx, orgId, ids);
}

async function lockRecords(
  trx: TransactionSql,
  orgId: string,
  events: readonly Withdrawable[],
): Promise<void> {
  const names = events.flatMap((e) =>
    e.recordKey
      ? [
          documentLockName(orgId, {
            connector: e.connector,
            workspace: e.workspace,
            recordKey: e.recordKey,
          }),
        ]
      : [],
  );
  const ordered = [...new Set(names)].sort();
  if (ordered.length === 0) return;
  await trx`
    select pg_advisory_xact_lock(hashtextextended(t.k, 0))
      from unnest(${ordered}::text[]) with ordinality as t(k, n)
     order by t.n`;
}

async function withdrawRows(
  trx: TransactionSql,
  orgId: string,
  ids: readonly string[],
): Promise<Withdrawal> {
  const documents = (
    await trx<{ source_id: string }[]>`
      select distinct source_id from source_revision where event_id = any(${[...ids]}::text[])`
  ).map((r) => r.source_id);
  const gone = await trx`
    delete from event_log where org_id = ${orgId} and id = any(${[...ids]}::text[]) returning 1`;
  if (documents.length === 0) return { events: gone.length, documents: [] };
  // The documents whose current revision this took: theirs is the entry a listing reads. The open writer keys no
  // series, so a repointed document has none either.
  const moved = await trx<{ id: string }[]>`
    select id from source_document
    where org_id = ${orgId} and id = any(${documents}::text[]) and current_event_id is null`;
  await repointDocuments(trx, orgId, documents, null);
  await dropRevisionless(trx, orgId, documents);
  return { events: gone.length, documents: moved.map((d) => d.id) };
}

/** The keyword entries' deletion, after the commit; how many the sidecar did not take. */
export async function forgetKeywords(writes: Writes, ids: string[]): Promise<number> {
  const { endpoint } = writeHooksOf(writes).keyword;
  if (!endpoint.configured()) return 0;
  try {
    await endpoint.withdraw(ids);
    return 0;
  } catch {
    // swallowed: counted in the run's summary; a stale entry is never read (above).
    return ids.length;
  }
}

/**
 * The document entries a withdrawal moved, after its commit, where the build's index holds them (`keyword-index.ts`
 * `documents`): a document left with a revision is indexed again from the one now current, which writes its entry
 * (`keyword-documents.ts`); one left with none has its entry deleted. How many the index did not take.
 */
export async function refreshDocuments(
  writes: Writes,
  orgId: string,
  documents: readonly string[],
): Promise<number> {
  const { keyword } = writeHooksOf(writes);
  if (documents.length === 0 || !keyword.endpoint.configured() || !keyword.documents) return 0;
  const { sql } = writes;
  const standing = await sql<{ id: string; current: string }[]>`
    select id, current_event_id as current from source_document
    where org_id = ${orgId} and id = any(${[...documents]}::text[]) and current_event_id is not null`;
  const kept = new Set(standing.map((d) => d.id));
  let missed = await forgetKeywords(
    writes,
    documents.filter((d) => !kept.has(d)).map(documentEntryId),
  );
  const currents = standing.map((d) => d.current);
  await sql`update event_log set keyword_indexed_at = null where org_id = ${orgId} and id = any(${currents}::text[])`;
  for (const result of await indexOpen(writes, orgId, currents))
    if (result.keyword === "missed") missed++;
  return missed;
}
