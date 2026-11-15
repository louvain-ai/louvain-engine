/**
 * Writing a text's passages, the retrieval tier, stage by stage: cut it, then for each slice embed and write, then
 * settle its older versions. A passage carries its record's collection verbatim, so it is fenced by exactly the join
 * that fences the record it was cut from: adding retrieval surface never adds an access path.
 */
import { chunk } from "../ingest/cut.js";
import { embedSlice } from "../ingest/embed.js";
import { indexableEvent, textRows } from "../ingest/passage-rules.js";
import { stage } from "../ingest/stage.js";
import { settleVersions, writeSlice } from "../ingest/write.js";
import { type Writes, writeHooksOf } from "../writes.js";
import type { PlannedContext } from "./passage-context-write.js";
import { checkWork, workTransaction } from "./work-seam.js";

/**
 * The verbatim tier, written for every admitted message, so a question can be answered from the words actually said.
 * Only the chunks whose text changed are embedded and written, in slices that each commit (a retry skips what landed),
 * and a record cut into fewer chunks than before loses its rows past the new end. `planned` carries each chunk's
 * context, written with it. A slice that finds the event gone stops the rest, unsettled.
 */
export async function writePassages(
  writes: Writes,
  ctx: MemoryWriteContext,
  text: string,
  planned: readonly PlannedContext[] | null = null,
): Promise<number> {
  const { passageRules } = writeHooksOf(writes);
  const missing = await cutText(writes, ctx, text);
  let written = 0;
  for (const slice of slicesOf(missing)) {
    const rows = await stage("ingest.embed", () => embedSlice(passageRules, slice, planned));
    const count = await stage("ingest.write", () => writeSlice(writes, ctx, rows));
    if (count === null) return written;
    written += count;
  }
  await settleVersions(writes, ctx, missing);
  return written;
}

export type MemoryWriteContext = {
  eventId: string;
  orgId: string;
  workspace: string;
  container: string;
  author: string;
  occurredAt: string;
  /** Whether the author relays rather than speaks for itself; declared by the source, first-hand when absent. */
  relays?: boolean;
};

/**
 * Chunks embedded and written per transaction: small enough that an attempt cut short keeps most of its work, large
 * enough that a short record is still one request and one transaction.
 */
export const PASSAGE_SLICE = 32;

/** The cut stage: the text's chunks whose stored text differs, or null for a text with nothing to cut. */
async function cutText(
  writes: Writes,
  ctx: MemoryWriteContext,
  text: string,
): Promise<Piece[] | null> {
  checkWork();
  const chunks = chunk(writeHooksOf(writes).passageRules, text);
  if (chunks.length === 0) return null;
  return stage("ingest.cut", () => chunksToWrite(writes, ctx, chunks));
}

/** A chunk to write, and the place it is written at. */
export type Piece = { body: string; seq: number };

/** The pieces in slices of `PASSAGE_SLICE`, each embedded and written as one. */
function* slicesOf(missing: readonly Piece[] | null): Generator<Piece[]> {
  const pieces = missing ?? [];
  for (let at = 0; at < pieces.length; at += PASSAGE_SLICE)
    yield pieces.slice(at, at + PASSAGE_SLICE);
}

/** The chunks whose stored text differs, after removing rows past the new last chunk under the event's lock. */
async function chunksToWrite(
  writes: Writes,
  ctx: MemoryWriteContext,
  chunks: string[],
): Promise<Piece[]> {
  const { sql } = writes;
  const rules = writeHooksOf(writes).passageRules;
  const existing = await sql<{ seq: number; text: string }[]>`select seq, text from passage
    where event_id = ${ctx.eventId} and org_id = ${ctx.orgId} ${textRows(rules, sql)}`;
  const bySeq = new Map(existing.map((row) => [row.seq, row.text]));
  if (existing.some((row) => row.seq >= chunks.length))
    await workTransaction(sql, async (trx) => {
      const [event] = await trx`select id from event_log where id = ${ctx.eventId}
        and org_id = ${ctx.orgId} ${indexableEvent(rules, trx)} for update`;
      if (event)
        await trx`delete from passage where event_id = ${ctx.eventId} and org_id = ${ctx.orgId}
          and seq >= ${chunks.length} ${textRows(rules, trx)}`;
    });
  return chunks.flatMap((body, seq) => (bySeq.get(seq) === body ? [] : [{ body, seq }]));
}
