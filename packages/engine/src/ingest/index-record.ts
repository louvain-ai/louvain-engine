/**
 * Indexing content records, a batch at a time (one record is a batch of one), stage by stage; every indexer runs this,
 * so a passage has one definition:
 *
 *   record     the stored record, its header, and the context each chunk is written with (`record.ts`)
 *   passages   cut → (embed → write) per slice → settle (`ingest/passages.ts` `writePassages`)
 *   contexts   best effort: the contexts its passages were written without
 *   keyword    best effort: the batch's keyword entries in one durable write, or for a record with nothing to index
 *              none (`keyword.ts`)
 */

import { telemetry } from "../observability/telemetry.js";
import { isUnreachable } from "../observability/unreachable.js";
import {
  forgetDocumentEntry,
  indexKeywords,
  type KeywordRecord,
  keywordHeader,
} from "./keyword.js";
import { indexPassageContexts } from "./passage-context-write.js";
import { writePassages } from "./passages.js";
import { type IndexedRevision, revisionToIndex } from "./record.js";
import { bestEffort, stage } from "./stage.js";
import { type Writes, writeHooksOf } from "./writes.js";

/**
 * Make content records findable, in the order given. Returns the passages written for each; 0 for a record with nothing
 * to index. Idempotent: passages are keyed on (event_id, seq) and a keyword entry is written once (`keyword_indexed_at`).
 */
export async function indexRevisions(
  writes: Writes,
  eventIds: readonly string[],
): Promise<number[]> {
  if (eventIds.length <= 1) return indexBatch(writes, eventIds);
  try {
    return await indexBatch(writes, eventIds);
  } catch {
    // swallowed: the batch is taken again a record at a time (idempotent: written passages and entries are kept), each
    // failing or counted as it always did, so a record's outcome never depends on its neighbours'.
    const written: number[] = [];
    for (const eventId of eventIds) written.push(...(await indexBatch(writes, [eventId])));
    return written;
  }
}

/** One batch: the records read, their passages embedded in one call and written, their contexts, their keyword entries. */
async function indexBatch(writes: Writes, eventIds: readonly string[]): Promise<number[]> {
  const records: (IndexedRevision | null)[] = [];
  for (const eventId of eventIds)
    records.push(await stage("ingest.record", () => revisionToIndex(writes, eventId)));
  const present = records.flatMap((r) => (r ? [r] : []));
  const done = await writePassages(
    writes,
    present.map((r) => ({ ctx: r.ctx, text: r.header.text, planned: r.planned })),
  );
  const keyworded: KeywordRecord[] = [];
  const written = records.map((r) => (r ? (done[present.indexOf(r)] ?? 0) : 0));
  for (const [i, record] of records.entries()) {
    await contextsOf(writes, record, written[i] ?? 0);
    if (!record) await forgetDocumentEntry(writes, eventIds[i] ?? "");
    else keyworded.push(await keywordInput(writes, record));
  }
  await indexKeywords(writes, keyworded);
  return written;
}

/** The contexts a write did not carry: none planned, or a write cut short. */
async function contextsOf(
  writes: Writes,
  record: IndexedRevision | null,
  written: number,
): Promise<void> {
  if (!record) return;
  const { ctx, header, planned } = record;
  if (planned && written === planned.length) return;
  await bestEffort("ingest.contexts", () => indexPassageContexts(writes, ctx, header), {
    missed: missedContexts,
    work: writeHooksOf(writes).work,
  });
}

/** What its keyword entry is written from; a record with nothing to index leaves its document none (above). */
async function keywordInput(
  writes: Writes,
  { ctx, header }: IndexedRevision,
): Promise<KeywordRecord> {
  return { ctx, text: header.text, header: await keywordHeader(writes, ctx.orgId, header) };
}

/** A context not written moves rank only: an unreachable sidecar is a deferral, anything else a fault; both counted. */
function missedContexts(err: unknown): void {
  if (!isUnreachable(err)) telemetry.error("ingest.passage_context", err, {});
  telemetry.count("ingest.passage_context.missed", 1, {});
}
