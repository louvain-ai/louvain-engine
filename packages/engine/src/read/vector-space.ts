import { embedderOf } from "../store/embedder.js";
import { type Embedder, readEmbedderOf } from "./context.js";
import type { ReadContext } from "./fence.js";
import { queryVectorWith } from "./question.js";

/**
 * Which vector space a workspace is searched in. Every search that compares a query vector with stored vectors takes
 * its columns and its query embedder from here together, so a query from one model is never ranked against another
 * model's column. The engine has one space, the current one: a change of model is a re-index. A build that keeps a
 * second space beside it while a workspace moves hands it to its reads (`ReadHooks.spaces`); a read handed none reads
 * `ONE_SPACE`. A caller that passes its own embedder keeps the current columns.
 */
type VectorColumns = { passage: string; statement: string };
export type VectorSpace = {
  name: string;
  columns: VectorColumns;
  embedder: Embedder;
  /** Told when a query in this space could not be embedded and was read in the current space instead. */
  fellBack?: () => void;
  /** The current space a query falls back to when this one's lane cannot answer; the current space has none. */
  fallback?: VectorSpace;
};

/** A space a build keeps beside the current one: its columns and its two embedding lanes. */
export type OtherSpace = {
  name: string;
  columns: VectorColumns;
  /** A query's vector, from a function that stays the same (the memo is kept per loader, `recent-vectors.ts`). */
  query: (text: string) => Promise<number[]>;
  documents: (texts: string[]) => Promise<number[][]>;
};

/**
 * What a build's vector spaces are:
 *
 *   `spaceFor`    the space a workspace is searched in when it is not the current one, else null; none in a build
 *                 with one space.
 *   `fellBack`    told when a query in that space could not be embedded and was read in the current space instead.
 */
export type VectorSpaces = {
  spaceFor: ((orgId: string) => Promise<OtherSpace | null>) | null;
  fellBack: () => void;
};

/** The open build's: the current space alone. */
export const ONE_SPACE: VectorSpaces = { spaceFor: null, fellBack: () => {} };

const CURRENT_COLUMNS: VectorColumns = { passage: "embedding", statement: "embedding" };

/** The space's query lane memoised on the question (`queryVectorWith`), its document lane, and whom it tells. */
const searched = (other: OtherSpace, fellBack: () => void, fallback: VectorSpace): VectorSpace => ({
  name: other.name,
  columns: other.columns,
  embedder: {
    query: (text, orgId) => queryVectorWith(text, other.query, orgId),
    documents: other.documents,
  },
  fellBack,
  fallback,
});

/**
 * The space a workspace is searched in, among the read's spaces (`ReadHooks.spaces`): another the build keeps for it,
 * else the current one, embedded by the read's own embedder (`embedderOf`).
 */
export async function vectorSpaceFor(
  on: Pick<ReadContext, "hooks">,
  orgId: string,
  override?: Embedder,
): Promise<VectorSpace> {
  const here: VectorSpace = {
    name: "current",
    columns: CURRENT_COLUMNS,
    embedder: override ?? readEmbedderOf(embedderOf(on)),
  };
  if (override) return here;
  const spaces = on.hooks?.spaces ?? ONE_SPACE;
  const other = await spaces.spaceFor?.(orgId);
  return other ? searched(other, spaces.fellBack, here) : here;
}

/**
 * Embed a query in a space, the space it was embedded in returned with it: a query in another space whose lane cannot
 * answer is embedded in the current space instead, and the CURRENT columns are what it is then ranked against — the
 * two flip together, never one without the other. A current-space failure is the caller's.
 */
export async function queryIn(
  space: VectorSpace,
  text: string,
  orgId?: string,
): Promise<{ space: VectorSpace; vector: number[] | string }> {
  const { fallback } = space;
  if (!fallback) return { space, vector: await space.embedder.query(text, orgId) };
  try {
    return { space, vector: await space.embedder.query(text, orgId) };
  } catch {
    // swallowed: another space's lane that cannot answer costs this search that space, not its vector leg: the
    // current columns are searched with the current model instead, and the build is told.
    space.fellBack?.();
    return { space: fallback, vector: await fallback.embedder.query(text, orgId) };
  }
}
