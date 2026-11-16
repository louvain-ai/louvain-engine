/**
 * The embed stage: one call for every bare chunk of a batch of records, then, in a build that keeps a context vector
 * (`PassageRules.contextVector`), the contextual text of each chunk that has a context, so a chunk's two vectors come
 * from one call and are written together. The embedder sends the call in requests of its own size.
 */
import { toPgVector } from "@louvain/embeddings";
import { embedderOf } from "../store/embedder.js";
import type { PlannedContext } from "./passage-context-write.js";
import type { Piece } from "./passages.js";
import { type Writes, writeHooksOf } from "./writes.js";

/** One record's chunks to embed, and the contexts planned for them. */
export type ToEmbed = { missing: readonly Piece[]; planned: readonly PlannedContext[] | null };

/** One embedding call for the records' chunks: each record's rows, in the order given. */
export async function embedRecords(
  writes: Writes,
  records: readonly ToEmbed[],
): Promise<SliceRow[][]> {
  const { passageRules: rules, work } = writeHooksOf(writes);
  work.check();
  const embedsContext = rules.contextVector !== null;
  const texts = records.map(({ missing, planned }) => [
    ...missing.map((part) => part.body),
    ...(embedsContext
      ? missing.flatMap(({ seq }) => (planned?.[seq] ? [planned[seq].embedText] : []))
      : []),
  ]);
  const vectors = await embedderOf(writes).embed(texts.flat());
  work.check();
  let at = 0;
  return records.map((record, i) => {
    const from = at;
    at += texts[i]?.length ?? 0;
    return rowsOf(record, vectors.slice(from, at), embedsContext);
  });
}

/** A record's rows from its vectors: every bare chunk's, then each context's, in the order they were asked. */
function rowsOf(
  { missing, planned }: ToEmbed,
  vectors: number[][],
  embedsContext: boolean,
): SliceRow[] {
  const contexts = missing.map(({ seq }) => planned?.[seq] ?? null);
  let next = missing.length;
  return missing.map(({ body, seq }, i) => {
    const vector = vectors[i];
    if (!vector) throw new Error("embedding missing for passage");
    const c = contexts[i] ?? null;
    let contextVector: string | null = null;
    if (c && embedsContext) {
      const v = vectors[next++];
      if (!v) throw new Error("embedding missing for passage context");
      contextVector = toPgVector(v);
    }
    return { seq, text: body, vector: toPgVector(vector), c, contextVector };
  });
}

/** A chunk ready to write: its text, its vector, and its context with that context's vector. */
export type SliceRow = {
  seq: number;
  text: string;
  vector: string;
  c: PlannedContext | null;
  contextVector: string | null;
};
