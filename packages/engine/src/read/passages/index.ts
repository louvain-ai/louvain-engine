import { passagesAsDocuments } from "./document.js";
import { passagesAround, passagesById, searchPassages } from "./search.js";

/**
 * `passages.*` of the read primitives, as its own module so a caller that needs only these loads only what they call.
 */
export const passages = {
  search: searchPassages,
  byId: passagesById,
  around: passagesAround,
  /** Each record's readable passages as one text, header first: what the reranker reads. */
  asDocuments: passagesAsDocuments,
};
