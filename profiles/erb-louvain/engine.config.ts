import { defineEngine } from "@louvain/engine-core";
import { sidecar } from "@louvain/reranker-sidecar";

/**
 * The scored configuration with the published reranker in Cohere's place, in the rerank sidecar you start yourself
 * (the scored profile's README, "The other two profiles"), at LOUVAIN_RERANK_URL. Each document is sent whole up to 8,000
 * characters, the length it was tuned and measured at, and its order used as it is. One search's 150 documents took
 * about ten minutes on Apple silicon (bfloat16), so a run needs a GPU; the wait is a minute.
 */
export default defineEngine({
  reranker: sidecar({
    url: process.env.LOUVAIN_RERANK_URL ?? "http://localhost:8096",
    model: "Louvain/rerank-4b-erb",
    timeoutMs: 60_000,
    blend: 1,
  }),
  settings: {
    retrieval: { searchQuestion: true, bestPassage: true },
    rerank: { window: 150, feed: "document", documentChars: 8_000, blend: 1 },
  },
});
