/**
 * The write stage: a slice's rows, of one record or several, inserted each under its event's row lock, so a withdrawal
 * or a hold that lands first stops that record; each slice commits on its own, so an attempt cut short keeps what
 * landed and a retry resumes. Once a record is whole, its older versions are settled.
 */
import type { Sql, TransactionSql } from "postgres";
import { telemetryOf } from "../host/given.js";
import { embedderOf } from "../store/embedder.js";
import { recordEmbeddingSpace } from "../store/embedding-space.js";
import { laterVersion } from "../store/version.js";
import type { SliceRow } from "./embed.js";
import { indexableRevision } from "./passage-rules.js";
import { afterPassagesWritten } from "./passage-writes.js";
import type { MemoryWriteContext } from "./passages.js";
import { dropDocumentSupersededVectors } from "./superseded-vectors.js";
import { type Writes, writeHooksOf } from "./writes.js";

/** One record's part of a slice: its context and its rows. */
export type SlicePart = { ctx: MemoryWriteContext; rows: SliceRow[] };

/**
 * One slice's rows written, in one transaction: for each record, how many, or null when its event is no longer there
 * to write them for. What follows a write runs once the slice has committed, so it sees the rows.
 */
export async function writeSlice(
  writes: Writes,
  parts: readonly SlicePart[],
): Promise<(number | null)[]> {
  const written = await writeHooksOf(writes).work.transaction(async (trx) => {
    const out: (string[] | null)[] = [];
    for (const part of parts) out.push(await insertRows(writes, trx, part));
    return out;
  });
  const ids = written.flatMap((w) => w ?? []);
  // Which space these vectors are in, once per workspace per process: a model change without a re-embed shows at boot.
  const orgId = parts[0]?.ctx.orgId;
  if (ids.length > 0 && orgId) await recordEmbeddingSpace(embedderOf(writes), writes.sql, orgId);
  // And whatever the build does after a write (`passage-write-seam.ts`): best effort, never a failure of this write.
  const { passageWrites } = writeHooksOf(writes);
  await afterPassagesWritten(passageWrites, "passage", ids);
  await afterPassagesWritten(passageWrites, "context", ids);
  return written.map((w) => (w === null ? null : w.length));
}

/**
 * Records written whole settle their older versions: their passages are flagged (for each record this write added
 * passages to, in one statement for the batch) and the vectors a newer version supersedes are dropped. A re-read that
 * wrote nothing still drops them, as after a write; a text with nothing to cut (`missing` null) settles nothing.
 */
export async function settleVersions(
  writes: Writes,
  records: readonly { ctx: MemoryWriteContext; missing: readonly unknown[] | null }[],
): Promise<void> {
  const settled = records.filter((r) => r.missing !== null);
  const added = settled.filter((r) => (r.missing?.length ?? 0) > 0).map((r) => r.ctx);
  if (added.length > 0) await flagOlderVersions(writes, added);
  for (const { ctx } of settled)
    await dropDocumentSupersededVectors(writes, ctx.orgId, ctx.eventId);
}

/**
 * Once this version is read into passages, its record's older versions' passages carry the hint the version rule
 * gates on: the rule retires an older version only once a newer one has passages, so this is the first moment the hint
 * matters. It is done here, off the accept path, because flagging a row writes a new entry into every passage index;
 * a passage later written for an older version copies its version's flag itself (`insertSlice`).
 */
async function flagOlderVersions(
  writes: Writes,
  records: readonly MemoryWriteContext[],
): Promise<void> {
  const ids = records.map((r) => r.eventId);
  const orgId = records[0]?.orgId ?? "";
  await writeHooksOf(writes).work.transaction(async (trx) => {
    await trx`
      update passage p set record_has_newer = true
        from event_log n, event_log o
       where n.id = any(${ids}::text[]) and n.org_id = ${orgId} and n.record_key is not null
         and o.org_id = n.org_id and o.connector = n.connector and o.workspace = n.workspace
         and o.record_key = n.record_key and o.has_newer and ${laterVersion(trx, trx`n`, trx`o`)}
         and p.event_id = o.id and p.org_id = o.org_id and not p.record_has_newer`;
  });
}

/**
 * Insert the slice under the event's row lock, or null when the event is gone: quarantine and withdrawal serialize
 * against that lock, so a late embedding cannot recreate a removed passage. New words take their old context away, and
 * each row copies its version's newer-version hint, set at accept, so a version indexed late carries it too.
 */
async function insertRows(
  writes: Writes,
  trx: TransactionSql,
  { ctx, rows }: SlicePart,
): Promise<string[] | null> {
  const { passageRules: rules } = writeHooksOf(writes);
  const [event] = await trx`select id from event_log where id = ${ctx.eventId}
    and org_id = ${ctx.orgId} ${indexableRevision(rules, trx)} for update`;
  if (!event) return null;
  // The context vector's column, in a build that keeps one (`PassageRules.contextVector`).
  const col = rules.contextVector;
  // The context's words, in a build whose database keeps them (`PassageRules.contextWords`).
  const words = rules.contextWords;
  const written = await trx`
    insert into passage (org_id, event_id, workspace, container, author, seq, text, embedding, occurred_at,
                         relayed, context, context_key, ${col ? trx`${trx(col)},` : trx``} ${words ? trx`${trx(words.column)},` : trx``} record_has_newer)
    select ${ctx.orgId}::uuid, ${ctx.eventId}, ${ctx.workspace}, ${ctx.container}, ${ctx.author},
           u.seq, u.text, u.vec::vector, ${ctx.occurredAt}::timestamptz, ${ctx.relays ?? false},
           u.context, u.key, ${col ? trx`u.vec_ctx::vector,` : trx``}
           ${words ? trx`case when u.context is null then null else ${words.of(trx, trx`u.context`, trx`u.text`)} end,` : trx``}
           (select has_newer from event_log where id = ${ctx.eventId} and org_id = ${ctx.orgId})
      from unnest(${rows.map((r) => r.seq)}::int[], ${rows.map((r) => r.text)}::text[],
                  ${rows.map((r) => r.vector)}::text[], ${rows.map((r) => r.c?.context ?? null)}::text[],
                  ${rows.map((r) => r.c?.key ?? null)}::text[], ${rows.map((r) => r.contextVector)}::text[])
        as u(seq, text, vec, context, key, vec_ctx)
    on conflict (event_id, seq) do update set ${col ? trx`${trx(col)} = excluded.${trx(col)},` : trx``}
      ${words ? trx`${trx(words.column)} = excluded.${trx(words.column)},` : trx``}
      text = excluded.text, embedding = excluded.embedding, context = excluded.context, context_key = excluded.context_key
    where passage.text is distinct from excluded.text returning id::text as id`;
  const withContext = rows.filter((r) => r.c).length;
  if (withContext > 0)
    telemetryOf(writes).count("passage.context.written", withContext, { mode: "header" });
  return (written as unknown as { id: string }[]).map((w) => w.id);
}
