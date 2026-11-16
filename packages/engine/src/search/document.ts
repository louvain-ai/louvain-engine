import type { RelevanceCutoffs } from "@louvain/engine-core";
import type { Embedder } from "../read/embedding.js";
import type { DocumentFilters } from "../read/filters.js";
import type { SpeakerNamer } from "../read/passages/around.js";
import type { Neighbour } from "../read/passages/search.js";
import type { RevisionSummary } from "../read/records/read.js";
import type { RerankWith } from "./pool-types.js";

/**
 * The one document shape a search returns, and what it is asked with. Every stage of `search.ts` reads or writes these,
 * and nothing else: a pool of fused rows in, a page of documents out.
 */

/** One document on the page: the version that matched, its summary, the passage that ranked it. */
export type SearchedDocument = {
  /** The record the best passage came from: the document's version that matched. */
  recordId: string;
  summary: RevisionSummary;
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

export type SearchOptions = {
  limit: number;
  mode?: "hybrid" | "keyword";
  asOf?: string;
  /** Narrows the fence, never widens it: an app, a date range, a space's containers. */
  narrow?: DocumentFilters & { containers?: string[] };
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
