import type postgres from "postgres";
import { type Presented, type SourceOrigin, sourceMetadata } from "../read/originals/metadata.js";
import { sanitizeId } from "../store/ids.js";
import { rankOf } from "../store/version.js";
import type { Revision } from "./revision.js";

/**
 * A source's document and revision rows, written by one definition for every accept path: the upsert keeps a
 * document's current revision by the version rule, each revision row carries its event's own collection, and a stored
 * origin key is never rewritten. The keys are the build's (`SourceOrigin.keys`); the open accept has none.
 */
export type DocumentEntry<P extends Presented = Presented> = {
  event: Revision;
  workspace: string;
  m: NonNullable<ReturnType<typeof sourceMetadata<P>>>;
};

/**
 * Each event's source metadata, under its sanitised workspace, its presentation read by the build's reader
 * (`origin.presentation`); an event with none (not a source) is left out.
 */
export function documentEntries<P extends Presented>(
  events: Revision[],
  orgId: string,
  origin: SourceOrigin<P>,
): DocumentEntry<P>[] {
  return events.flatMap((event) => {
    const workspace = sanitizeId(event.source.workspace);
    const m = sourceMetadata({ ...event, source: { ...event.source, workspace } }, orgId, origin);
    return m ? [{ event, workspace, m }] : [];
  });
}

/** Upsert each document once (its newest revision by the version rule) and insert every revision. */
export async function writeDocumentRows(
  trx: postgres.TransactionSql,
  { entries, orgId }: { entries: DocumentEntry[]; orgId: string },
): Promise<{ revisions: { event_id: string; source_id: string }[] }> {
  const documents = documentRows(entries, orgId);
  await upsertDocuments(trx, documents);
  const ids = await canonicalIds(trx, documents, orgId);
  const revisions = revisionRows(entries, ids);
  await insertRevisions(trx, revisions, orgId);
  return { revisions };
}

type DocumentRow = ReturnType<typeof documentRows>[number];
type RevisionRow = ReturnType<typeof revisionRows>[number];

/** One document row per entry, carrying its newest-known revision as the pointer. */
function documentRows(entries: DocumentEntry[], orgId: string) {
  return entries.map(({ event, workspace, m }) => ({
    id: m.id,
    org_id: orgId,
    connector: event.source.connector,
    workspace,
    native_id: m.nativeId,
    origin_key: m.originKey,
    // The series its revision states: it follows the current revision, as the pointer does.
    series_key: m.seriesKey,
    current_event_id: event.id,
    current_modified_at: m.modifiedAt,
  }));
}

/**
 * The pointer moves only for a newer revision, or for any revision when it points at none (a document a replacement
 * kept for its new revision). An origin key is set when the document has none and never rewritten: the same inputs name
 * the same original.
 */
async function upsertDocuments(trx: postgres.TransactionSql, documents: DocumentRow[]) {
  await trx`insert into source_document (id, org_id, connector, workspace, native_id, origin_key, series_key, current_event_id, current_modified_at)
    select distinct on (org_id, connector, workspace, native_id)
      id, org_id::uuid, connector, workspace, native_id, origin_key, series_key, current_event_id, current_modified_at::timestamptz
    from jsonb_to_recordset(${trx.json(documents)}) as d(id text, org_id text, connector text,
      workspace text, native_id text, origin_key text, series_key text, current_event_id text, current_modified_at text)
    order by org_id, connector, workspace, native_id, ${rankOf(trx, trx`d.current_event_id`, trx`current_modified_at::timestamptz`)} desc, current_event_id desc
    on conflict (org_id, connector, workspace, native_id) do update set
      current_event_id = case when source_document.current_event_id is null or ${heldRank(trx)} < ${arrivingRank(trx)}
          or (${heldRank(trx)} = ${arrivingRank(trx)}
            and source_document.current_event_id is not null
            and source_document.current_event_id < excluded.current_event_id)
        then excluded.current_event_id else source_document.current_event_id end,
      series_key = case when source_document.current_event_id is null or ${heldRank(trx)} < ${arrivingRank(trx)}
          or (${heldRank(trx)} = ${arrivingRank(trx)} -- sql-shape: the conflicting row only, as current_event_id's case above
            and source_document.current_event_id is not null
            and source_document.current_event_id < excluded.current_event_id)
        then excluded.series_key else source_document.series_key end,
      -- A document a replacement kept for this revision takes the revision's time, not the withdrawn one's.
      current_modified_at = case when source_document.current_event_id is null or ${heldRank(trx)} < ${arrivingRank(trx)} then excluded.current_modified_at
        else greatest(source_document.current_modified_at, excluded.current_modified_at) end,
      origin_key = coalesce(source_document.origin_key, excluded.origin_key),
      -- A document a replacement kept for this revision has one again.
      revisionless_since = null
    where source_document.current_event_id is null or ${heldRank(trx)} < ${arrivingRank(trx)}
      or (${heldRank(trx)} = ${arrivingRank(trx)}
        and source_document.current_event_id is not null
        and source_document.current_event_id < excluded.current_event_id)
      or (source_document.origin_key is null and excluded.origin_key is not null)`;
}

/** Each document's stored id: a backfill may recover a native identity without changing the id people saved. */
async function canonicalIds(trx: postgres.TransactionSql, documents: DocumentRow[], orgId: string) {
  const canonical = await trx<
    { id: string; connector: string; workspace: string; native_id: string }[]
  >`
    select distinct s.id, s.connector, s.workspace, s.native_id from source_document s
    join jsonb_to_recordset(${trx.json(documents)}) as d(connector text, workspace text, native_id text)
      on s.connector = d.connector and s.workspace = d.workspace and s.native_id = d.native_id
    where s.org_id = ${orgId}`;
  return new Map(canonical.map((d) => [identity(d.connector, d.workspace, d.native_id), d.id]));
}

const identity = (connector: string, workspace: string, nativeId: string) =>
  JSON.stringify([connector, workspace, nativeId]);

/** One revision row per entry, under its document's stored id. */
function revisionRows(entries: DocumentEntry[], ids: Map<string, string>) {
  return entries.map(({ event, workspace, m }) => {
    const sourceId = ids.get(identity(event.source.connector, workspace, m.nativeId));
    if (!sourceId) throw new Error("Source identity was not persisted");
    return {
      event_id: event.id,
      source_id: sourceId,
      title: m.title,
      kind: m.kind,
      author: m.author,
      location: m.location,
      url: m.url,
      modified_at: m.modifiedAt,
      metadata_status: m.metadataStatus,
      content: m.content,
      content_hash: m.contentHash,
      content_truncated: m.contentTruncated,
      presentation: m.presentation ?? null,
    };
  });
}

/** Insert every revision; its container is copied from its event, so a read by container needs no probe per revision. */
async function insertRevisions(
  trx: postgres.TransactionSql,
  revisions: RevisionRow[],
  orgId: string,
) {
  await trx`insert into source_revision
    (event_id, source_id, title, kind, author, location, url, modified_at, metadata_status, content, content_hash, content_truncated, presentation,
     container)
    select r.event_id, source_id, title, r.kind, author, location, url, modified_at::timestamptz,
      metadata_status, content, content_hash, content_truncated, presentation,
      (select e.container from event_log e where e.id = r.event_id and e.org_id = ${orgId})
    from jsonb_to_recordset(${trx.json(revisions)}) as r(event_id text, source_id text, title text,
      kind text, author text, location text, url text, modified_at text, metadata_status text,
      content text, content_hash text, content_truncated boolean, presentation jsonb)
    on conflict (event_id) do nothing`;
}

/*
 * The pointer ranks as the version rule does: a revision's own time, or the rank stored for a time the accept chose.
 * Both sides are read off their events in the statement, never kept beside the pointer, so a writer that moves it
 * knowing no ranks leaves nothing stale; the held side reads its revision's own time, never `current_modified_at`.
 */
const heldRank = (q: postgres.TransactionSql) =>
  rankOf(
    q,
    q`source_document.current_event_id`,
    q`coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)`,
  );
const arrivingRank = (q: postgres.TransactionSql) =>
  rankOf(q, q`excluded.current_event_id`, q`excluded.current_modified_at`);
