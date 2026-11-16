/**
 * The keyword index's document entries, where the build's index holds them (`keyword-index.ts` `documents`): one per
 * document beside its records' entries, so a listing read from the index pages, counts and facets DOCUMENTS, under the
 * same fence as every read. An entry is its document's CURRENT revision: written with that revision's own entry, in
 * the same durable batch and from the same text and header, under one id per document, so a new revision replaces it.
 * A revision that is not current writes none, and a current one with nothing to index (no text, past the cap, held)
 * leaves its document no entry, so a listing never matches the text a document no longer has (the writes:
 * `ingest/document-entry.ts`). A withdrawal that moves a document's current revision writes it again from the one now
 * current, and one that leaves a document no revision deletes it (`ingest/withdraw.ts`). Here: the ids alone,
 * which the reads of a listing share with the writes.
 */

const ENTRY = "doc:";

/** The id a document's entry is kept under, apart from every record's (an event id). */
export const documentEntryId = (documentId: string): string => `${ENTRY}${documentId}`;

/** The document an entry id names (`documentEntryId`'s inverse). */
export const documentOfEntry = (entryId: string): string => entryId.slice(ENTRY.length);
