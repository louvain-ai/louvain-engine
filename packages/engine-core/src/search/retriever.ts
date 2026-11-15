import type { ReadingScope } from "./scope.js";

/**
 * A RETRIEVER: one way a search finds candidates, a plugin of the `retriever` kind. The engine ships three (vector,
 * keyword, figures) and a deployment may add its own; every one is read the same way and fused by the engine.
 *
 * A retriever is handed a `FencedReading`, never the pool: every read on it is already narrowed to the asker's scope,
 * and the scope itself (`ReadingScope`) is there for one that asks an index of its own, to pass as its filter clauses.
 * What it returns are records, in its own rank order: rows the reading handed it, or ids from its own index. The engine
 * reads every one again under the scope, as it reads its own keyword index's hits (the fence, the version current as of
 * the search, every narrowing), so each word, date and place it shows is its own; one it cannot read is dropped and
 * counted. A retriever is trusted code in the engine's process; what it returns is not. A read never throws: a failed
 * one has no hits and names itself in `degraded`.
 */
export type Retriever = {
  candidates(ask: RetrieverAsk, read: FencedReading): Promise<Retrieved>;
  /** Optional: reads again once the first legs are fused, from the page they made (a hop from what was found). */
  after?(ask: RetrieverAsk, read: FencedReading, page: readonly Candidate[]): Promise<Retrieved>;
};

/** What a search asks: its words, a leg's depth, how the words match, and `bounded` (recall reads one pass only). */
export type RetrieverAsk = {
  readonly query: string;
  readonly limit: number;
  readonly mode: "hybrid" | "keyword";
  readonly bounded: boolean;
};

/** A row a reading handed out: the record it is evidence from. The engine knows the rest of it. */
export type Candidate = { readonly recordId: string };

type ReadMode = RetrieverAsk["mode"] | "vector";
type PassagesShown = { readonly digits: boolean; readonly bestPassage: boolean };
/** The reads a retriever may make, each inside the asker's scope. */
export type FencedReading = {
  readonly scope: ReadingScope;
  /**
   * Passages for these words: both ways fused (`hybrid`) or one (`vector`, `keyword`); `digits`: those stating a figure;
   * `bestPassage: false`: a keyword hit shown by its first passage, not its best-matching one.
   */
  passages(
    query: string,
    opts: { readonly mode: ReadMode; readonly limit: number } & Partial<PassagesShown>,
  ): Promise<{ readonly hits: readonly Candidate[]; readonly degraded: readonly string[] }>;
};

/** What one retriever found: its legs, each in its own rank order, and anything it could not read. */
export type Retrieved = {
  readonly legs: readonly { readonly leg: string; readonly rows: readonly Candidate[] }[];
  readonly degraded: readonly string[];
};
