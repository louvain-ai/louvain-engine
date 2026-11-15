import { passagesAround, passagesById, searchPassages } from "./passages.js";
import { passagesAsDocuments } from "./passages-document.js";

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
