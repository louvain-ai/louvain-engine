import { type Embedder as ModelEmbedder, toPgVector } from "@louvain/embeddings";
import { queryVectorFor } from "./query-vector.js";

// ———————————————————————————— embedding ————————————————————————————

/**
 * The two sides of the asymmetric embedder, as the read primitives use them: by default a query goes through
 * `queryVectorFor` (the interactive lane, memoised), stored text through the bulk lane passages are embedded on. Tests
 * pass a deterministic one.
 */
export type Embedder = {
  /** A query vector, as numbers or a pgvector literal; `orgId` lets it be shared within that workspace for a minute. */
  query(text: string, orgId?: string): Promise<number[] | string>;
  documents(texts: string[]): Promise<number[][]>;
};

/** The read primitives' two sides of a model embedder (`@louvain/embeddings`): its query lane memoised, its bulk lane. */
export const readEmbedderOf = (model: ModelEmbedder): Embedder => ({
  query: (text, orgId) => queryVectorFor(model, text, orgId),
  documents: (texts) => model.embed(texts, "bulk"),
});

export const asPgVector = (v: number[] | string): string =>
  typeof v === "string" ? v : toPgVector(v);
