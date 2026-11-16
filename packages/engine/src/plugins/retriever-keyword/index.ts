import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";

/**
 * The keyword retriever: passages by the search's words alone, as one leg. The reading runs the keyword leg under its
 * own fence, filters and decay (the engine's keyword read, `read/keyword/leg.ts`: the build's keyword index, or a build's own passes),
 * and this retriever hands its rows on in their rank order, for the engine to fuse with the other legs. A read that
 * fails comes back empty and named by the reading, never costing the search.
 */
export const keywordRetriever = definePlugin({
  kind: "retriever",
  name: "keyword",
  settings: z
    .object({
      /** A hit shown by its best-matching passage, the part that matched; `false`, by its first. */
      bestPassage: z.boolean().default(true),
    })
    .strict(),
  create: ({ bestPassage }) => ({
    candidates: async (ask, read) => {
      const page = await read.passages(ask.query, {
        mode: "keyword",
        limit: ask.limit,
        bestPassage,
      });
      return { legs: [{ leg: "keyword", rows: page.hits }], degraded: page.degraded };
    },
  }),
});
