import type { Reranker, Viewer } from "@louvain/engine-core";
import type { Settings } from "../config/settings.js";
import type { ReadContext } from "../read/fence.js";
import type { ConversationOptions, SearchOptions } from "./document.js";
import type { WithIds } from "./evidence.js";

/** What the cross-encoder scores against when there is a question (`rerankQueryOf`). */
export type RerankWith = "question" | "query" | "question+query";

/**
 * What a search reads with: its pool, the engine's settings (whether a question is searched, how the reranker is fed),
 * and what the caller tells its conversation stage.
 */
export type SearchWith = {
  pool: SearchPool;
  settings: Pick<Settings, "retrieval" | "rerank">;
  conversation?: ConversationOptions;
};

/** One fused row of the pool, with the legs that found it. */
export type Pooled = { evidence: WithIds; score: number; legs: string[] };

/**
 * Where the rows come from: the query's legs (and the question's, when there is one), fused into one ranking under the
 * reader's fence. The open build reads its retriever plugins (`pool.ts`); another build may pass its own.
 * The reranker that orders what it found travels with it, `null` for none; left out, the one the engine was made with.
 */
export type SearchPool = ((
  context: ReadContext,
  viewer: Viewer,
  ask: { query: string; question: string | null; depth: number; opts: SearchOptions },
) => Promise<{ found: Pooled[]; degraded: string[] }>) & { readonly reranker?: Reranker | null };
