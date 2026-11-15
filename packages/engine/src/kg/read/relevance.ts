import type { Viewer } from "@louvain/engine-core";
import type { Embedder } from "./context.js";
import { fence, fenced, type ReadContext } from "./fence.js";
import { hooksOf } from "./hooks.js";
import { queryIn, type VectorSpaces, vectorSpaceFor } from "./space.js";

/**
 * HOW WELL EACH SHOWN DOCUMENT MATCHES THE SEARCH, in two facts a person can check:
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
  query: string,
  recordIds: readonly string[],
  /** `meaning`: the text whose meaning is measured (the search's own, or the words of it that carry meaning), or none. */
  opts: { meaning: string | null; embedder?: Embedder },
): Promise<Map<string, Relevance>> {
  const { sql } = context;
  const ids = [...new Set(recordIds)];
  const reader = await fence(context, viewer);
  if (!reader || ids.length === 0 || query.trim() === "") return new Map();
  const vector = opts.meaning
    ? await queryVector(hooksOf(context).spaces, reader.orgId, opts.meaning, opts.embedder)
    : null;
  const rows = await sql<{ id: string; meaning: number | null }[]>`
    select p.event_id as id,
      ${vector ? sql`max(1 - (${sql(vector.column)} <=> ${vector.value}::vector))` : sql`null`}::float8 as meaning
    from passage p
    where p.org_id = ${reader.orgId} and p.event_id = any(${ids}::text[])
      and ${fenced(sql, reader, sql`p.container`, { record: sql`p.event_id` })}
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

/** WHICH OF THESE WORDS A READABLE PASSAGE HOLDS, by the build's words test, under the reader's fence. */
export async function heldWords(
  context: ReadContext,
  viewer: Viewer,
  words: readonly string[],
): Promise<Set<string>> {
  const reader = await fence(context, viewer);
  if (!reader || words.length === 0) return new Set();
  return hooksOf(context).keyword.words.held(context, reader, words);
}

/**
 * THE LITERALS A SEARCH NAMES, each compared whole: a figure as bare digits ("2400", "2,400", "2.400", "2 400" and
 * "£2,400" are one number, and "2,400" never matches a bare "400"), and an IDENTIFIER, a token of letters and digits
 * together however hyphenated ("SUP-1042", "sup1042", a GUID), as its letters and digits alone; lower case, without
 * accents. A passage holds a figure when its text, its separators removed (`joined`), has it as a whole word, and an
 * identifier when it writes those letters and digits in order, hyphenated anywhere or not. Spaced, "sup 1042" is two
 * words and a figure.
 */
export function literalsOf(query: string): string[] {
  const q = fold(query);
  const ids = identifiersIn(q).map((w) => w.replace(/-/g, ""));
  const figures = (withoutIdentifiers(q).match(FIGURE) ?? []).map((f) => f.replace(/[ ,.]/g, ""));
  return [...new Set([...ids, ...figures])];
}

/**
 * THE SEARCH'S WORDS, no literal's pieces among them: the text search holds "SUP-1042" as "sup-1042", "sup" and "1042",
 * so as words a search for one ticket matched every "SUP-" ticket, and a GUID's fragments matched any document holding
 * one of them; it holds "2,400" as "2" and "400", so "2,400" matched "400 units" and "2400" did not. Identifiers and
 * figures are literals (`literalsOf`); the words are the rest, folded.
 */
export const wordsOf = (query: string): string =>
  withoutIdentifiers(fold(query)).replace(FIGURE, " ");

/**
 * A figure as a person writes it: bare digits, or groups of three after a separator, never part of a longer number
 * ("2,400 2400" is two figures, not "2,400 240" and a stray "0").
 */
const FIGURE = /(?<![\d.,])(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?![\d]|[.,]\d)/g;

const TOKEN = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
const isIdentifier = (token: string) => /\p{L}/u.test(token) && /\p{N}/u.test(token);
const identifiersIn = (folded: string) => (folded.match(TOKEN) ?? []).filter(isIdentifier);
const withoutIdentifiers = (folded: string) =>
  folded.replace(TOKEN, (token) => (isIdentifier(token) ? " " : token));

/** Lower case, without accents: "Café" and "cafe" are one word to a person typing. */
export const fold = (text: string): string =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** The search's vector in the space the vector leg reads, and the column it reads; null when it cannot answer. */
async function queryVector(
  spaces: VectorSpaces,
  orgId: string,
  query: string,
  embedder?: Embedder,
) {
  try {
    const { space, vector } = await queryIn(
      await vectorSpaceFor(spaces, orgId, embedder),
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
