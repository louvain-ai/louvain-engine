import { readRecord, recordSummaries } from "./read.js";
import { relatedRecords } from "./related.js";
import { recordWindow } from "./window.js";

/**
 * The record reads a search or read tool needs: a record's text, its window, its related sources and what to call it,
 * each fenced in SQL. None reads names, so loading these loads no identity code.
 */
export const records = {
  window: recordWindow,
  read: readRecord,
  /** The other messages of a record's thread and the other versions and copies of its document, fenced. */
  related: relatedRecords,
  summaries: recordSummaries,
};
