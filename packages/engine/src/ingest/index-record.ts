/**
 * Indexing one content record, stage by stage; every indexer runs this, so a passage has one definition:
 *
 *   record     the stored record, its header, and the context each chunk is written with (`record.ts`)
 *   passages   cut → (embed → write) per slice → settle (`ingest/passages.ts` `writePassages`)
 *   contexts   best effort: the contexts its passages were written without
 *   keyword    best effort: its keyword entry, or for a record with nothing to index none (`keyword.ts`)
 */

import { telemetry } from "../observability/telemetry.js";
import { isUnreachable } from "../observability/unreachable.js";
import { forgetDocumentEntry, indexKeywords, keywordHeader } from "./keyword.js";
import { indexPassageContexts } from "./passage-context-write.js";
import { writePassages } from "./passages.js";
import { type IndexedRecord, recordToIndex } from "./record.js";
import { bestEffort, stage } from "./stage.js";
import { type Writes, writeHooksOf } from "./writes.js";

/**
 * Make one content record findable. Returns the passages written; 0 for a record with nothing to index. Idempotent:
 * passages are keyed on (event_id, seq) and a keyword entry is written once (`keyword_indexed_at`).
 */
export async function indexRecord(writes: Writes, eventId: string): Promise<number> {
  const record = await stage("ingest.record", () => recordToIndex(writes, eventId));
  const written = await passagesOf(writes, record);
  await contextsOf(writes, record, written);
  await keywordOf(writes, eventId, record);
  return written;
}

const passagesOf = async (writes: Writes, record: IndexedRecord | null): Promise<number> =>
  record ? writePassages(writes, record.ctx, record.header.text, record.planned) : 0;

/** The contexts a write did not carry: none planned, or a write cut short. */
async function contextsOf(
  writes: Writes,
  record: IndexedRecord | null,
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

/** Its keyword entry; a record with nothing to index leaves its document none (`forgetDocumentEntry`). */
async function keywordOf(
  writes: Writes,
  eventId: string,
  record: IndexedRecord | null,
): Promise<void> {
  if (!record) return forgetDocumentEntry(writes, eventId);
  const { ctx, header } = record;
  await indexKeywords(writes, ctx, header.text, await keywordHeader(writes, ctx.orgId, header));
}

/** A context not written moves rank only: an unreachable sidecar is a deferral, anything else a fault; both counted. */
function missedContexts(err: unknown): void {
  if (!isUnreachable(err)) telemetry.error("ingest.passage_context", err, {});
  telemetry.count("ingest.passage_context.missed", 1, {});
}
