import { readRevision, revisionSummaries } from "./read.js";
import { relatedRevisions } from "./related.js";
import { revisionWindow } from "./window.js";

/**
 * The record reads a search or read tool needs: a record's text, its window, its related sources and what to call it,
 * each fenced in SQL. None reads names, so loading these loads no identity code.
 */
export const records = {
  window: revisionWindow,
  read: readRevision,
  /** The other messages of a record's thread and the other versions and copies of its document, fenced. */
  related: relatedRevisions,
  summaries: revisionSummaries,
};
