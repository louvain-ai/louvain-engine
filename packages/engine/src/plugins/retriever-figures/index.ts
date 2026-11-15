import { definePlugin } from "@louvain/engine-core";

/** A search that asks for a figure: the figures leg reads only for one that does. */
export const WANTS_FIGURE =
  /\b(how much|how many|price|cost|costs|value|amount|total|revenue|arr|mrr|budget|salary|discount|percent|%|\$|£|€)\b/i;

/**
 * The figures retriever: for a search that asks for a figure ("how much", "budget", "£"), the passages that state one,
 * by meaning and by words, at half the depth. It reads nothing for any other search, nor where a search reads one pass
 * only (`bounded`). A read that fails comes back empty and named by the reading, never costing the search.
 */
export const figuresRetriever = definePlugin({
  kind: "retriever",
  name: "figures",
  create: () => ({
    candidates: async (ask, read) => {
      if (!WANTS_FIGURE.test(ask.query) || ask.bounded) return { legs: [], degraded: [] };
      const limit = Math.ceil(ask.limit / 2);
      const page = await read.passages(ask.query, { mode: "hybrid", limit, digits: true });
      return {
        legs: [{ leg: "figures", rows: page.hits }],
        degraded: page.degraded,
      };
    },
  }),
});
