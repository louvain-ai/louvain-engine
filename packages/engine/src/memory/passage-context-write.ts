/**
 * Writing a passage's context: planned before the passage is written, so both texts share one embedding request, and
 * filled afterwards for a passage written without one. Every write is conditioned on the passage's own text and on the
 * event standing under its row lock, so a late embedding never lands on a passage that changed or a record that went.
 */
import { toPgVector } from "@louvain/embeddings";
import type { PendingQuery, Row, Sql, TransactionSql } from "postgres";
import { embedderOf } from "../embedder.js";
import { recordEmbeddingSpace } from "../embedding-space.js";
import { telemetryOf } from "../given.js";
import { chunk } from "../ingest/cut.js";
import { contextVectorNull, indexableEvent, type PassageRules } from "../ingest/passage-rules.js";
import type { Queryable } from "../kg/core/sql.js";
import { passageContextMode, writesPassageContext } from "../kg/read/passage-context-mode.js";
import { afterPassagesWritten } from "../passage-write-seam.js";
import { type Writes, writeHooksOf } from "../writes.js";
import { contextualText } from "./contextual-text.js";
import { composeContext, contextKey, type HeaderRecord } from "./passage-context.js";
import type { MemoryWriteContext } from "./store.js";

/** A new chunk's context, planned before its passage is written: the context, its key and the text to embed. */
export type PlannedContext = { context: string; key: string; embedText: string } | null;

/**
 * The context each chunk will carry, planned before its passages are written, so `writePassages` embeds a chunk's bare
 * and contextual texts in one request and inserts the row once with both vectors. Null when the workspace's mode writes
 * no context.
 */
export async function plannedContexts(
  writes: Writes,
  orgId: string,
  record: HeaderRecord,
): Promise<PlannedContext[] | null> {
  if (!writesPassageContext(await passageContextMode(writes.sql, orgId))) return null;
  const rules = writeHooksOf(writes).passageRules;
  const chunks = chunk(rules, record.text);
  const headers = rules.passageHeaders(record, chunks);
  return chunks.map((text, seq) => {
    const context = composeContext(headers[seq] ?? null);
    if (context === null) return null;
    return { context, key: contextKey(context), embedText: contextualText(context, text) };
  });
}

/**
 * Fill the context columns of one record's passages that `writePassages` did not write with one (a row that existed,
 * a changed header); returns how many it wrote. Idempotent: a passage already holding the context it
 * would get, with its vector where the build keeps one (`PassageRules.contextVector`), is skipped. Each write is conditioned on the passage's text and on the event standing
 * under its row lock, so a late embedding cannot put a context on a passage that changed or a record that went.
 */
export async function indexPassageContexts(
  writes: Writes,
  ctx: Pick<MemoryWriteContext, "eventId" | "orgId">,
  record: HeaderRecord,
): Promise<number> {
  const { passageRules: rules, passageWrites, work } = writeHooksOf(writes);
  work.check();
  const { sql } = writes;
  if (!writesPassageContext(await passageContextMode(sql, ctx.orgId))) return 0;
  const chunks = chunk(rules, record.text);
  if (chunks.length === 0) return 0;
  const headers = rules.passageHeaders(record, chunks);
  // Where the build keeps no context vector, a passage holds its context when its key matches: there is no vector to
  // hold beside it.
  const col = rules.contextVector;
  const rows = await sql<
    { id: string; seq: number; text: string; key: string | null; has: boolean }[]
  >`
    select id::text as id, seq, text, context_key as key, ${col ? sql`${sql(col)} is not null` : sql`true`} as has
      from passage where event_id = ${ctx.eventId} and org_id = ${ctx.orgId} and vector_dropped_at is null`;
  const { write, clear } = contextChanges(rows, { chunks, headers });
  if (write.length === 0 && clear.length === 0) return 0;
  const embedder = embedderOf(writes);
  const vectors = col
    ? await embedder.embed(write.map((w) => contextualText(w.context, w.text)))
    : null;
  // Which embedding space these stored vectors are in, per workspace (`embedding-space.ts`).
  if (vectors && write.length > 0) void recordEmbeddingSpace(embedder, sql, ctx.orgId);
  work.check();
  const contextual: string[] = [];
  return work
    .transaction(async (trx) => {
      const [event] = await trx`select id from event_log where id = ${ctx.eventId}
      and org_id = ${ctx.orgId} ${indexableEvent(rules, trx)} for update`;
      if (!event) return 0;
      const written = await writeContexts(trx, ctx, { write, vectors, contextual, col, rules });
      if (clear.length > 0) await clearContexts(trx, ctx, { rows: clear, rules });
      telemetryOf(writes).count("passage.context.written", written, { mode: "header" });
      return written;
    })
    .then(async (written) => {
      // Whatever the build does after a write (`passage-write-seam.ts`): best effort.
      await afterPassagesWritten(passageWrites, "context", contextual);
      return written;
    });
}

type ContextWrite = { id: string; text: string; context: string; key: string };

/** Which passages take a new context and which lose theirs; a row cut from other words is left for its own writer. */
function contextChanges(
  rows: readonly { id: string; seq: number; text: string; key: string | null; has: boolean }[],
  plan: { chunks: string[]; headers: (string | null)[] },
) {
  const write: ContextWrite[] = [];
  const clear: { id: string; text: string }[] = [];
  for (const row of rows) {
    if (plan.chunks[row.seq] !== row.text) continue;
    const context = composeContext(plan.headers[row.seq] ?? null);
    if (context === null) {
      if (row.key !== null) clear.push({ id: row.id, text: row.text });
      continue;
    }
    const key = contextKey(context);
    if (row.key === key && row.has) continue;
    write.push({ id: row.id, text: row.text, context, key });
  }
  return { write, clear };
}

/**
 * Write each new context, with its vector where the build keeps one, where the passage's text is still the one it was
 * built beside.
 */
async function writeContexts(
  trx: TransactionSql,
  ctx: Pick<MemoryWriteContext, "eventId" | "orgId">,
  w: {
    write: ContextWrite[];
    vectors: number[][] | null;
    contextual: string[];
    /** The context vector's column, where the build keeps one (`PassageRules.contextVector`). */
    col: string | null;
    /** The build's rules, for the context's words where its database keeps them (`PassageRules.contextWords`). */
    rules: PassageRules;
  },
): Promise<number> {
  if (w.write.length === 0) return 0;
  const { write, col } = w;
  const vecs = write.map((_, i) => {
    if (!w.vectors) return null;
    const v = w.vectors[i];
    if (!v) throw new Error("embedding missing for passage context");
    return toPgVector(v);
  });
  const done = await trx`
        update passage p
           set ${wordsSet(w.rules, trx, { context: trx`u.context`, text: trx`p.text` })}
               ${col && w.vectors ? trx`${trx(col)} = u.vec::vector,` : trx``} context = u.context, context_key = u.key
          from unnest(${write.map((w) => w.id)}::uuid[], ${write.map((w) => w.text)}::text[],
                      ${write.map((w) => w.context)}::text[], ${write.map((w) => w.key)}::text[],
                      ${vecs}::text[]) as u(id, text, context, key, vec)
         where p.id = u.id and p.event_id = ${ctx.eventId} and p.org_id = ${ctx.orgId} and p.text = u.text
        returning p.id::text as id`;
  w.contextual.push(...(done as unknown as { id: string }[]).map((d) => d.id));
  return done.length;
}

/** Clear the context of each passage whose record now says nothing to situate it. */
async function clearContexts(
  trx: TransactionSql,
  ctx: Pick<MemoryWriteContext, "eventId" | "orgId">,
  { rows: clear, rules }: { rows: { id: string; text: string }[]; rules: PassageRules },
): Promise<void> {
  await trx`
        update passage p
           set ${contextVectorNull(rules, trx)} ${wordsSet(rules, trx, null)} context = null, context_key = null
          from unnest(${clear.map((c) => c.id)}::uuid[], ${clear.map((c) => c.text)}::text[]) as u(id, text)
         where p.id = u.id and p.event_id = ${ctx.eventId} and p.org_id = ${ctx.orgId} and p.text = u.text`;
}

/**
 * The context's words (`PassageRules.contextWords`) set from these values, or cleared where none are given
 * (`<column> = …,`), in a build whose database keeps them; nothing in one that keeps none.
 */
function wordsSet(
  rules: PassageRules,
  q: Queryable,
  values: { context: PendingQuery<Row[]>; text: PendingQuery<Row[]> } | null,
) {
  const words = rules.contextWords;
  if (!words) return q``;
  return values
    ? q`${q(words.column)} = ${words.of(q, values.context, values.text)},`
    : q`${q(words.column)} = null,`;
}
