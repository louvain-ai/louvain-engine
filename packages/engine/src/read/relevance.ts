import type { Viewer } from "@louvain/engine-core";
import type { Embedder } from "./embedding.js";
import { fence, type ReadContext } from "./fence.js";
import { fenced } from "./fenced.js";
import { hooksOf } from "./hooks.js";
import { queryIn, vectorSpaceFor } from "./vector-space.js";

/**
 * How well each shown document matches the search, in two facts a person can check:
 *
 *   `words`   it holds the search's words, by the build's words test (`keyword-index.ts` `words`): the open build's
 *             index holds every word searched in its first tier, a word no readable document holds read as a prefix or
 *             a typo of a held one, or left out (`tier-words.ts`);
 *   `meaning` the nearest of its passages, as cosine similarity to the search (0 to 1), in the space the vector leg
 *             searched; null when meaning was not asked for (keyword mode) or the embedding could not answer.
 *
 * Read under the reader's fence, for documents a search already found: nothing here finds anything new, and ranking
 * never reads it. A page uses it to say which of its documents match and which are only loosely related.
 */
export type Relevance = { words: boolean; meaning: number | null };

export async function relevanceOf(
  context: ReadContext,
  viewer: Viewer,
  {
    query,
    ids: recordIds,
    ...opts
  }: {
    query: string;
    ids: readonly string[];
    /** The text whose meaning is measured (the search's own, or the words of it that carry meaning), or none. */
    meaning: string | null;
    embedder?: Embedder;
  },
): Promise<Map<string, Relevance>> {
  const { sql } = context;
  const ids = [...new Set(recordIds)];
  const reader = await fence(context, viewer);
  if (!reader || ids.length === 0 || query.trim() === "") return new Map();
  const vector = opts.meaning
    ? await queryVector(context, {
        orgId: reader.orgId,
        query: opts.meaning,
        embedder: opts.embedder,
      })
    : null;
  const rows = await sql<{ id: string; meaning: number | null }[]>`
    select p.event_id as id,
      ${vector ? sql`max(1 - (${sql(vector.column)} <=> ${vector.value}::vector))` : sql`null`}::float8 as meaning
    from passage p
    where p.org_id = ${reader.orgId} and p.event_id = any(${ids}::text[])
      and ${fenced(sql, reader, { column: sql`p.container`, record: sql`p.event_id` })}
    group by p.event_id`;
  // Which hold the words is the build's keyword index's answer (`keyword-index.ts` `words`).
  const held = await hooksOf(context).keyword.words.holders(context, reader, { query, ids });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        words: held.has(r.id),
        meaning: r.meaning === null ? null : Math.round(r.meaning * 100) / 100,
      },
    ]),
  );
}

/** The search's vector in the space the vector leg reads, and the column it reads; null when it cannot answer. */
async function queryVector(
  context: ReadContext,
  { orgId, query, embedder }: { orgId: string; query: string; embedder?: Embedder | undefined },
) {
  try {
    const { space, vector } = await queryIn(
      await vectorSpaceFor(context, orgId, embedder),
      query,
      orgId,
    );
    const value = typeof vector === "string" ? vector : `[${vector.join(",")}]`;
    return { column: `p.${space.columns.passage}`, value };
  } catch {
    // swallowed: an embedding that cannot answer leaves `meaning` unknown (null), and the page says how it decided.
    return null;
  }
}
