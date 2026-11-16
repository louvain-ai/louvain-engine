/**
 * Writing a text's passages, the retrieval tier, stage by stage: cut it, then for each slice embed and write, then
 * settle its older versions. A passage carries its record's collection verbatim, so it is fenced by exactly the join
 * that fences the record it was cut from: adding retrieval surface never adds an access path.
 */
import { chunk } from "./cut.js";
import { embedRevisions } from "./embed.js";
import type { PlannedContext } from "./passage-context-write.js";
import { indexableRevision, textRows } from "./passage-rules.js";
import { stage } from "./stage.js";
import { settleVersions, writeSlice } from "./write.js";
import { inOneTransaction, type Writes, writeHooksOf } from "./writes.js";

/** One record's passages to write: its context, its text, and the context planned for each chunk. */
export type PassageWrite = {
  ctx: MemoryWriteContext;
  text: string;
  planned: readonly PlannedContext[] | null;
};

/**
 * The verbatim tier, written for every admitted message, so a question can be answered from the words actually said.
 * A batch of records at a time (one record is a batch of one): each record's changed chunks are cut, then the batch's
 * chunks go in slices of `PASSAGE_SLICE`, across its records: each slice embedded in one call and written in one
 * transaction that commits, so an attempt cut short keeps what landed and a retry resumes; a record cut into fewer
 * chunks than before loses its rows past the new end. `planned` carries each chunk's context, written with it. A slice
 * that finds a record's event gone stops that record's rest, unsettled. Returns each record's rows written.
 */
export async function writePassages(
  writes: Writes,
  records: readonly PassageWrite[],
): Promise<number[]> {
  const missing: (Piece[] | null)[] = [];
  for (const { ctx, text } of records) missing.push(await cutText(writes, ctx, text));
  const written = records.map(() => 0);
  const stopped = new Set<number>();
  for (const slice of slicesOf(
    missing.flatMap((m, i) => (m ?? []).map((piece) => ({ i, piece }))),
  )) {
    const parts = partsOf(slice.filter(({ i }) => !stopped.has(i)));
    const rows = await stage("ingest.embed", () =>
      embedRevisions(
        writes,
        parts.map(({ i, pieces }) => ({ missing: pieces, planned: records[i]?.planned ?? null })),
      ),
    );
    const counts = await stage("ingest.write", () =>
      writeSlice(
        writes,
        parts.map(({ i }, k) => ({ ctx: (records[i] as PassageWrite).ctx, rows: rows[k] ?? [] })),
      ),
    );
    for (const [k, { i }] of parts.entries()) {
      const count = counts[k];
      if (count === null || count === undefined) stopped.add(i);
      else written[i] = (written[i] ?? 0) + count;
    }
  }
  const whole = records.flatMap(({ ctx }, i) =>
    stopped.has(i) ? [] : [{ ctx, missing: missing[i] ?? null }],
  );
  await inOneTransaction(writes, (batch) => settleVersions(batch, whole));
  return written;
}

/** A slice's chunks, by the record they belong to, in order. */
function partsOf(slice: readonly { i: number; piece: Piece }[]): { i: number; pieces: Piece[] }[] {
  const parts: { i: number; pieces: Piece[] }[] = [];
  for (const { i, piece } of slice) {
    const last = parts.at(-1);
    if (last?.i === i) last.pieces.push(piece);
    else parts.push({ i, pieces: [piece] });
  }
  return parts;
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
  const { passageRules, work } = writeHooksOf(writes);
  work.check();
  const chunks = chunk(passageRules, text);
  if (chunks.length === 0) return null;
  return stage("ingest.cut", () => chunksToWrite(writes, ctx, chunks));
}

/** A chunk to write, and the place it is written at. */
export type Piece = { body: string; seq: number };

/** The chunks in slices of `PASSAGE_SLICE`, each embedded and written as one. */
function* slicesOf<T>(chunks: readonly T[]): Generator<T[]> {
  for (let at = 0; at < chunks.length; at += PASSAGE_SLICE)
    yield chunks.slice(at, at + PASSAGE_SLICE);
}

/** The chunks whose stored text differs, after removing rows past the new last chunk under the event's lock. */
async function chunksToWrite(
  writes: Writes,
  ctx: MemoryWriteContext,
  chunks: string[],
): Promise<Piece[]> {
  const { sql } = writes;
  const { passageRules: rules, work } = writeHooksOf(writes);
  const existing = await sql<{ seq: number; text: string }[]>`select seq, text from passage
    where event_id = ${ctx.eventId} and org_id = ${ctx.orgId} ${textRows(rules, sql)}`;
  const bySeq = new Map(existing.map((row) => [row.seq, row.text]));
  if (existing.some((row) => row.seq >= chunks.length))
    await work.transaction(async (trx) => {
      const [event] = await trx`select id from event_log where id = ${ctx.eventId}
        and org_id = ${ctx.orgId} ${indexableRevision(rules, trx)} for update`;
      if (event)
        await trx`delete from passage where event_id = ${ctx.eventId} and org_id = ${ctx.orgId}
          and seq >= ${chunks.length} ${textRows(rules, trx)}`;
    });
  return chunks.flatMap((body, seq) => (bySeq.get(seq) === body ? [] : [{ body, seq }]));
}
