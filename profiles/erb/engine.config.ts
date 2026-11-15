/**
 * The scored configuration: Cohere's Rerank API, `rerank-v4.0-pro`, with an 8-second timeout, its key from
 * `COHERE_API_KEY`; it sends no `top_n`, so every document it is handed comes back scored. The search's settings are the
 * scored ones, each stated even where it is the default, so this file is the record of what was scored. The readers are
 * the defaults: the corpus arrives as records. `run.ts up` makes it the profile every command runs (README.md).
 */

import { defineEngine } from "@louvain/engine-core";
import { cohere } from "@louvain/reranker-cohere";

export default defineEngine({
  reranker: cohere({ model: "rerank-v4.0-pro", timeoutMs: 8_000 }),
  settings: {
    retrieval: { searchQuestion: true, bestPassage: true },
    rerank: { window: 150, feed: "document", documentChars: 16_000, blend: 1 },
  },
});
