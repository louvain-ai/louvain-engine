import type { AskRow } from "./evidence.js";

const EXCERPT_CHARS = 600;

/**
 * What a document is shown by: a passage is the document's own words; a document known only through a statement it
 * voted for is shown by that statement, labelled as a fact extracted from the document, never passed off as its text.
 */
export const excerptOf = (row: Pick<AskRow, "text" | "tier">): string => {
  // Never ending inside a surrogate pair: a lone surrogate is refused by the database and garbles a client.
  const high = (row.text.charCodeAt(EXCERPT_CHARS - 1) & 0xfc00) === 0xd800;
  const cut = EXCERPT_CHARS - (high ? 1 : 0);
  const text = row.text.length > EXCERPT_CHARS ? `${row.text.slice(0, cut)}…` : row.text;
  return row.tier === "passage" ? text : `Extracted fact: ${text}`;
};
