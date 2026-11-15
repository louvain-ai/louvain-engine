/**
 * The embed stage: one request per slice for every bare chunk, then, in a build that keeps a context vector
 * (`PassageRules.contextVector`), the contextual text of each chunk that has a context, so a chunk's two vectors come
 * from one call and are written together.
 */
import { toPgVector } from "@louvain/embeddings";
import { embedderOf } from "../embedder.js";
import type { PlannedContext } from "../memory/passage-context-write.js";
import type { Piece } from "../memory/store.js";
import { type Writes, writeHooksOf } from "../writes.js";

/** One embedding request for the slice: every bare chunk, then the contextual text of each chunk that has a context. */
export async function embedSlice(
  writes: Writes,
  missing: readonly Piece[],
  planned: readonly PlannedContext[] | null,
): Promise<SliceRow[]> {
  const { passageRules: rules, work } = writeHooksOf(writes);
  work.check();
  const contexts = missing.map(({ seq }) => planned?.[seq] ?? null);
  const embedsContext = rules.contextVector !== null;
  const vectors = await embedderOf(writes).embed([
    ...missing.map((part) => part.body),
    ...(embedsContext ? contexts.flatMap((c) => (c ? [c.embedText] : [])) : []),
  ]);
  work.check();
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
