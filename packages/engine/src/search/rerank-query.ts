import { environment } from "../config/environment.js";
import type { RerankWith } from "./pool-types.js";

/**
 * What the reranker scores against, with a question: the call's `rerankWith`, else `LOUVAIN_SEARCH_RERANK_QUERY`:
 * `question` (the default), the agent's `query`, or `question+query` (the question, then the query on its own line). A
 * person's own words rank the answer first more often than an agent's rewrite; a later search sent for one part of a
 * many-part question may want its own query back. Without a question, the query. Read at each call.
 */
export function rerankQueryOf(query: string, question: string | null, asked?: RerankWith): string {
  if (question === null) return query;
  const env = (environment("LOUVAIN_SEARCH_RERANK_QUERY") ?? "").trim().toLowerCase();
  const how = asked ?? (env === "query" || env === "question+query" ? env : "question");
  return how === "query" ? query : how === "question+query" ? `${question}\n${query}` : question;
}
