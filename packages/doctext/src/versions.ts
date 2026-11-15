import type { DocKind } from "./classify.js";

/**
 * Which reader read it: a reading is kept, not redone, so every reading records its reader's version, and a caller
 * that keeps the bytes reads again what an older version read. Bump a format's number when its reader changes what
 * it reads (a cell, a paragraph, a page it missed), never for a refactor; the writer corpus (`test/writers.test.ts`)
 * fails an output change without a bump. A kind with no reader keeps 1.
 */
export const READER_VERSIONS: Readonly<Record<DocKind, number>> = {
  pdf: 1,
  // Character references read by HTML's own table in one pass (accented names, Windows-1252 numerics, no double
  // decode); alternate content read once: the `mc:Choice` if it has words, else the `mc:Fallback`.
  docx: 3,
  // Relationship and sheet attributes read by name; a cell sits in its own column and a date reads as a date; character
  // references as docx.
  xlsx: 4,
  // pptx, odf, epub and html read character references as docx does; a slide's text is its `a:t` runs only, so a styled
  // table's style id (the text of `a:tableStyleId`) is never a cell; pptx reads alternate content once, as docx does.
  pptx: 4,
  odf: 2,
  epub: 2,
  html: 2,
  rtf: 1,
  // Each event read as what, when, where and who (`calendar.ts`); a file of one event also states it as an invite
  // (UID, start instant, organiser) in its meta. A reading recorded as `text` is read again as this kind (`REREAD_AS`).
  calendar: 1,
  // The headers, the body (plain, else HTML read as text) and the names of what was attached (`email.ts`); a reading
  // recorded as `text` is read again as this kind (`REREAD_AS`).
  eml: 1,
  // A line per speaker's turn with its time (`subtitles.ts`); a reading recorded as `text` is read again as this kind
  // (`REREAD_AS`).
  subtitles: 1,
  text: 1,
  "legacy-office": 1,
  binary: 1,
  unknown: 1,
};

/** The version a reading that recorded none is taken to be. */
export const UNVERSIONED_READER = 1;

export function readerVersionOf(kind: DocKind): number {
  return READER_VERSIONS[kind] ?? UNVERSIONED_READER;
}
