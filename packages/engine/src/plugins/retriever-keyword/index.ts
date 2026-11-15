import { definePlugin } from "@louvain/engine-core";

/**
 * The keyword retriever: passages by the search's words alone, as one leg. The reading runs the keyword leg under its
 * own fence, filters and decay (`keyword-leg.ts`: the keyword index first, the Postgres passes where it cannot answer),
 * and this retriever hands its rows on in their rank order, for the engine to fuse with the other legs. A read that
 * fails comes back empty and named by the reading, never costing the search.
 */
export const keywordRetriever = definePlugin({
  kind: "retriever",
  name: "keyword",
  create: () => ({
    candidates: async (ask, read) => {
      const page = await read.passages(ask.query, { mode: "keyword", limit: ask.limit });
      return { legs: [{ leg: "keyword", rows: page.hits }], degraded: page.degraded };
    },
  }),
});
