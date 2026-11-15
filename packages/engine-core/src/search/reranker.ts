/**
 * A reranker: a plugin of the `reranker` kind that reads the search and each candidate's text together and scores how
 * well the candidate answers it, from 0 (not at all) to 1. The engine orders by these scores and may use them to say
 * which documents match; a reranker that cannot answer says so, and the engine keeps the order it had, named as not
 * reranked, never as ranked.
 */
export type Reranker = {
  /** The model behind the scores: a cut-off measured on one model is never applied to another's. */
  readonly model: string;
  /** The measured cut-offs for this model, when there are any (`RelevanceCutoffs`). */
  readonly cutoffs?: RelevanceCutoffs;
  /** How much of the order is the reranker's (1, all of it) against the legs' own; left out, the engine's setting. */
  readonly blend?: number;
  rerank(ask: RerankAsk): Promise<Reranked>;
};

/** At or above `matched` a document matches the search, whatever its other signals say. */
export type RelevanceCutoffs = { readonly matched: number };

/** The search's words and each candidate's text, in the engine's order. */
export type RerankAsk = { readonly query: string; readonly texts: readonly string[] };

/** One score in [0, 1] per text, in the order asked; or why there are none. */
export type Reranked =
  | { readonly ok: true; readonly scores: readonly number[] }
  | { readonly ok: false; readonly failure: string };
