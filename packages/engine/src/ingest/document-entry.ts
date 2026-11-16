import { displayApp } from "../read/listing/apps.js";
import { documentEntryId } from "../read/listing/keyword-documents.js";
import type { Bm25Doc } from "../store/keyword-document.js";
import { type Writes, writeHooksOf } from "./writes.js";

/**
 * A document's keyword entry, written with its current revision's (`read/listing/keyword-documents.ts` says what the entries
 * are): where the build's index holds them (`KeywordIndex.documents`), named by the build's app rule
 * (`AddedFilters.app`), both from the write's own hooks.
 */
/** The document entry a record's keyword entry brings with it: its document's, when it is the current revision. */
export async function documentEntryOf(writes: Writes, entry: Bm25Doc): Promise<Bm25Doc | null> {
  const { keyword, filters } = writeHooksOf(writes);
  if (!keyword.documents) return null;
  const [doc] = await writes.sql<{ id: string; modified: Date; app: string | null }[]>`
    select d.id, d.current_modified_at as modified, ${displayApp(writes.sql, filters.app)} as app
    from source_revision r join source_document d on d.id = r.source_id and d.current_event_id = r.event_id
    where r.event_id = ${entry.id} and d.org_id = ${entry.org}`;
  if (!doc) return null;
  return {
    id: documentEntryId(doc.id),
    kind: "document",
    org: entry.org,
    container: entry.container,
    occurredAt: entry.occurredAt,
    modified: doc.modified.toISOString(),
    text: entry.text,
    ...(entry.header ? { header: entry.header } : {}),
    ...(doc.app ? { app: doc.app } : {}),
  };
}

/** The entry of the document whose CURRENT revision this record is, or null when it is not one's current revision. */
export async function entryOfCurrent(writes: Writes, eventId: string): Promise<string | null> {
  if (!writeHooksOf(writes).keyword.documents) return null;
  const [doc] = await writes.sql<{ id: string }[]>`
    select d.id from source_revision r join source_document d on d.id = r.source_id and d.current_event_id = r.event_id
    where r.event_id = ${eventId}`;
  return doc ? documentEntryId(doc.id) : null;
}
