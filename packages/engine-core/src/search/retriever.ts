/**
 * A RETRIEVER: one way a search finds candidates, a plugin of the `retriever` kind. The engine ships three (vector,
 * keyword, figures) and a deployment may add its own; every one is read the same way and fused by the engine.
 *
 * A retriever is handed a `FencedReading`, never the pool: every read on it is already narrowed to the asker's scope.
 * What it returns are rows that reading handed it, in its own rank order; the engine keeps only those, re-checks each
 * against the scope by id, and drops and counts any other. That is defence in depth, not a sandbox: a retriever is
 * trusted code in the engine's process. A read never throws: a failed one has no hits and names itself in `degraded`.
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
/** The reads a retriever may make, each inside the asker's scope. */
export type FencedReading = {
  /** Passages for these words: both ways fused (`hybrid`) or one (`vector`, `keyword`); `digits`: those stating a figure. */
  passages(
    query: string,
    opts: { readonly mode: ReadMode; readonly limit: number; readonly digits?: boolean },
  ): Promise<{ readonly hits: readonly Candidate[]; readonly degraded: readonly string[] }>;
};

/** What one retriever found: its legs, each in its own rank order, and anything it could not read. */
export type Retrieved = {
  readonly legs: readonly { readonly leg: string; readonly rows: readonly Candidate[] }[];
  readonly degraded: readonly string[];
};
