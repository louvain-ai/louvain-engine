/**
 * The package's entry: a file's bytes to the text a person wrote in it (`extract.ts`), the kinds it reads, and the
 * names a caller needs from its readers. Parsing needs no model and no sidecar, and the package holds no
 * credentials: it is handed bytes.
 */
import { type DocKind, extensionKinds } from "./classify.js";

export type { DocKind } from "./classify.js";
export type { DocText, DocTextReason, ExtractOptions } from "./doc-text.js";
export { extractText } from "./extract.js";
export {
  DEFAULT_DEADLINE_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_PAGES,
} from "./extract-limits.js";
export { classifyFile } from "./file-kind.js";
export type { DocLocator } from "./locator.js";
export { shiftLocators } from "./locator.js";
export type { CellEdge, CellLook } from "./looks.js";
export { type Cue, cueSeconds, parseCues } from "./subtitles-cues.js";
export { offset } from "./subtitles-read.js";
export { mergeTurns, type Turn, UNKNOWN_SPEAKER } from "./subtitles-turns.js";
export {
  READER_VERSIONS,
  readerVersionOf,
  UNVERSIONED_READER,
} from "./versions.js";
export { ReaderBusy, ReaderUnavailable } from "./worker-errors.js";
export { boundedZip, zipParts } from "./zip-archive.js";
export { DecompressionRefused, ZIP_LIMITS } from "./zip-limits.js";

/** Kinds that have a reader — what a caller may bother downloading. */
export const READABLE: ReadonlySet<DocKind> = new Set<DocKind>([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odf",
  "epub",
  "html",
  "rtf",
  "calendar",
  "eml",
  "subtitles",
  "text",
]);

/**
 * The extensions with a text reader, dotted (`.pdf`, `.docx`, …): what a file picker may offer and a route that takes
 * files accepts by name, read off the table `classify` uses, so a format that gains a reader is offered the day it does.
 */
export function readableExtensions(): string[] {
  return extensionKinds()
    .filter(([, kind]) => READABLE.has(kind))
    .map(([ext]) => `.${ext}`);
}
