import type { Case } from "./search.cases.js";

/**
 * A fact deep in a long document, asked in other words, leaves the first ten. An agent's search ranks a document by its
 * best passage (`LOUVAIN_AGENT_SEARCH_CHUNK_BONUS` 0); summed over its passages, the code of conduct (gifts from
 * suppliers, in its third) ranked third for "presents from vendors", and by its best passage it is past the tenth. The
 * stand-in embedder links neither word to the passage's, so that third place was its length alone: this corpus cannot
 * show a loss a search could win back without letting length lead. The case pins that length no longer lifts a
 * document; the rule below is what a search that reads the paraphrase must win back, and it drops this.
 */
export const DEEP_FACT_LOST: Case = {
  name: "a fact deep in a long document, in other words",
  run: (e) => e.tool("louvain_search_sources", { query: "presents from vendors", limit: 10 }),
  defect:
    "the code of conduct, which answers it in its third passage, is not in the first ten; see DEEP_FACT_LOST",
};
