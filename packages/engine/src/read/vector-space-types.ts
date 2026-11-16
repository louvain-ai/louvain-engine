import type { Embedder } from "./embedding.js";

/**
 * Which vector space a workspace is searched in. Every search that compares a query vector with stored vectors takes
 * its columns and its query embedder from here together, so a query from one model is never ranked against another
 * model's column. The engine has one space, the current one: a change of model is a re-index. A build that keeps a
 * second space beside it while a workspace moves hands it to its reads (`ReadHooks.spaces`); a read handed none reads
 * `ONE_SPACE`. A caller that passes its own embedder keeps the current columns.
 */
export type VectorColumns = { passage: string; statement: string };

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
