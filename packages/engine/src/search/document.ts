import type { RelevanceCutoffs, Reranker, Viewer } from "@louvain/engine-core";
import type { WithIds } from "../ask/evidence.js";
import type { Settings } from "../config/settings.js";
import type { Embedder } from "../kg/read/context.js";
import type { ReadContext } from "../kg/read/fence.js";
import type { RecordFilters } from "../kg/read/filters.js";
import type { Neighbour } from "../kg/read/passages.js";
import type { SpeakerNamer } from "../kg/read/passages-around.js";
import type { RecordSummary } from "../kg/read/record-read.js";

/**
 * The one document shape a search returns, and what it is asked with. Every stage of `search.ts` reads or writes these,
 * and nothing else: a pool of fused rows in, a page of documents out.
 */

/** One document on the page: the version that matched, its summary, the passage that ranked it. */
export type SearchedDocument = {
  /** The record the best passage came from: the document's version that matched. */
  recordId: string;
  summary: RecordSummary;
  /** The passage that ranked the document. */
  excerpt: string;
  score: number;
  /** How well the reranker judged it answers the search, 0 to 1, when a reranker scored it. */
  relevance?: number;
  /** Its best place in the keyword leg (`words`) and the vector leg (`meaning`) before fusion; null where not found. */
  ranks?: { words: number | null; meaning: number | null };
  /**
   * Where the passage that ranked it sits in its record's stored text, when the read found it there: the stored
   * passage is flattened to one line for indexing, and a page that shows the text as written cuts it from here.
   */
  span?: { start: number; end: number };
  /**
   * The messages either side of this one in its conversation, oldest first, when the document is a chat message
   * among the first few hits: context for reading it, not hits. Each opens by its `recordId`.
   */
  conversation?: Neighbour[];
};

export type DocumentSearch = {
  documents: SearchedDocument[];
  /** More documents ranked than were returned. */
  hasMore: boolean;
  /** Legs that degraded, by bounded name (a sidecar down, a pass cut by its timeout): never a silent short page. */
  degraded: string[];
  /** The reranker that scored this search's documents, when one did. */
  reranked?: { model: string; cutoffs?: RelevanceCutoffs };
};

/** What the cross-encoder scores against when there is a question (`rerankQueryOf`). */
export type RerankWith = "question" | "query" | "question+query";

export type SearchOptions = {
  limit: number;
  mode?: "hybrid" | "keyword";
  asOf?: string;
  /** Narrows the fence, never widens it: an app, a date range, a space's containers. */
  narrow?: RecordFilters & { containers?: string[] };
  embedder?: Embedder;
  /** The person's question for the turn, verbatim (`questionFor`): searched beside the query, and what ranks. */
  question?: string;
  /** What the cross-encoder scores against when there is a question; the switch's choice otherwise. */
  rerankWith?: RerankWith;
  /** Document ids a caller already showed (`withoutShown`): left out, and the page read further down the SAME order. */
  exclude?: ReadonlySet<string>;
  /** How far the passage legs read: `full`, or `bounded` to their cheap candidates only. */
  recall: "full" | "bounded";
  /** Whether the configured reranker reorders the documents. */
  rerank: boolean;
};

/**
 * What the conversation stage asks of the caller (`withConversations`): who a chat message's author is to this reader,
 * and the earlier messages a hit is linked back to. Neither passed, the authors read as written and nothing is linked.
 */
export type ConversationOptions = {
  names?: SpeakerNamer;
  ancestry?: (orgId: string, recordId: string) => Promise<string[]>;
};

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
 * The reranker that orders what it found travels with it, `null` for none; left out, the bound one (`rerank-seam.ts`).
 */
export type SearchPool = ((
  context: ReadContext,
  viewer: Viewer,
  query: string,
  question: string | null,
  depth: number,
  opts: SearchOptions,
) => Promise<{ found: Pooled[]; degraded: string[] }>) & { readonly reranker?: Reranker | null };
