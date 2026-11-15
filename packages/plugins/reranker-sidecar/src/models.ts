import type { RelevanceCutoffs } from "@louvain/engine-core";

/** A shipped model: the hub commit its weights are fetched at, its licence, its cut-off and blend. */
export type ShippedModel = {
  readonly revision: string;
  readonly licence: string;
  readonly cutoffs: RelevanceCutoffs;
  readonly blend: number;
};

/** The model the sidecar is built with unless the configuration names another. */
export const DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3";

/**
 * The models this plugin ships, each with a cut-off set from its own scores (another cross-encoder runs by its hub
 * name, with no cut-off). 0.5, its even odds, sits between searches no document answers (scored near zero) and
 * keyword answers (scored high), so it adds a match and never hides one. Its order alone (blend 1) puts a
 * paraphrase's answer first far more often than half and half, at a small cost to keyword answers.
 */
export const MODELS: Readonly<Record<string, ShippedModel>> = {
  "BAAI/bge-reranker-v2-m3": {
    revision: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
    licence: "Apache-2.0",
    cutoffs: { matched: 0.5 },
    blend: 1,
  },
};
