/** A file's kind from its name and type, before a byte is fetched, and the sentence a refusal shows a person. */
import { classify, type DocKind } from "./classify.js";
import { listZip } from "./zip-archive.js";

export const LEGACY_NOTE =
  "Word, Excel and PowerPoint 97-2003 files have no text reader; re-save it in the modern format";

export const noReaderFor = (filename?: string, mimeType?: string): string =>
  `No text reader for ${mimeType || filename || "this file"}`;

export const EMPTY = new Uint8Array(0);

/** The kind alone, for a caller that wants to label a file it did not read. */
export function classifyFile(filename?: string, mimeType?: string, data?: Uint8Array): DocKind {
  return classify({ filename, mimeType, data: data ?? EMPTY, listZip });
}
