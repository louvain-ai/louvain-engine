import { definePlugin } from "@louvain/engine-core";

/**
 * The vector retriever: passages by meaning, one leg (`vector`), ranked by the embedding space the workspace reads
 * (`kg/read/passages.ts` in vector mode). The engine fuses it with the other retrievers' legs (`search/fused.ts`). A
 * search asked by its words alone (`mode: "keyword"`) reads nothing here. A read that fails comes back empty and
 * named by the reading, never costing the search.
 */
export const vectorRetriever = definePlugin({
  kind: "retriever",
  name: "vector",
  create: () => ({
    candidates: async (ask, read) => {
      if (ask.mode === "keyword") return { legs: [], degraded: [] };
      const page = await read.passages(ask.query, { mode: "vector", limit: ask.limit });
      return { legs: [{ leg: "vector", rows: page.hits }], degraded: page.degraded };
    },
  }),
});
