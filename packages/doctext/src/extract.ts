/**
 * A file's bytes to the text a person wrote in it: bytes in, plain text out, no policy. It never sees a collection or
 * a reader, makes no network call and decides nothing about who may read what. Each format has its reader, and a
 * reading that cannot be made is an answer about the file (`DocTextReason`), never an exception a caller retries.
 */
import { CalendarDeadline, CalendarRefused, calendarText } from "./calendar.js";
import { classify, type DocKind } from "./classify.js";
import type { DocText, DocTextReason, ExtractOptions } from "./doc-text.js";
import { EmailDeadline, EmailRefused, emailText } from "./email.js";
import {
  DEFAULT_DEADLINE_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_PAGES,
} from "./extract-limits.js";
import { classifyFile, LEGACY_NOTE, noReaderFor } from "./file-kind.js";
import { type DocLocator, shiftLocators } from "./locator.js";
import { PdfDeadline, pdfText } from "./pdf.js";
import { decodeText, htmlToText, rtfToText, tidy } from "./plain.js";
import {
  SUBTITLE_BYTES_PER_CHAR,
  SubtitlesDeadline,
  SubtitlesRefused,
  subtitlesText,
} from "./subtitles.js";
import { readerVersionOf } from "./versions.js";
import { ReaderUnavailable } from "./worker-errors.js";
import { listZip } from "./zip-archive.js";
import { DecompressionRefused } from "./zip-limits.js";
import { epubText, odfText, pptxText } from "./zip-slides.js";
import { docxText } from "./zip-word.js";
import { xlsxText } from "./zip-xlsx.js";

const refuse = (kind: DocKind, reason: DocTextReason, detail: string): DocText => ({
  kind,
  readerVersion: readerVersionOf(kind),
  text: "",
  chars: 0,
  truncated: false,
  reason,
  detail,
  meta: {},
  locators: [],
});

/**
 * One file's text. Never throws for a bad document: a caller importing ten thousand files needs an answer per file.
 * It throws only `ReaderUnavailable`, when the host could not start a reader's process: no fact about the file, so
 * the caller retries it.
 */
export async function extractText(
  data: Uint8Array,
  options: ExtractOptions = {},
): Promise<DocText> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (data.length === 0) return refuse("unknown", "empty", "The file is empty");
  if (data.length > maxBytes)
    return refuse(
      classifyFile(options.filename, options.mimeType),
      "too-large",
      `The file is ${Math.round(data.length / 1_048_576)} MB; the limit is ${Math.round(maxBytes / 1_048_576)} MB`,
    );

  const kind = classify({
    filename: options.filename,
    mimeType: options.mimeType,
    data,
    listZip,
  });
  if (kind === "legacy-office") return refuse(kind, "legacy-office", LEGACY_NOTE);
  if (kind === "binary" || kind === "unknown")
    return refuse(kind, "unsupported-format", noReaderFor(options.filename, options.mimeType));

  let read: Read;
  try {
    read = await readKind(kind, data, { options, maxChars });
  } catch (error) {
    return refusal(kind, error);
  }
  return finished(kind, read, maxChars);
}

type Read = { text: string; meta: Record<string, unknown>; locators: DocLocator[] };
type ReadAs = { options: ExtractOptions; maxChars: number };

/** The reader for `kind`, by the format's own shape: paginated, a zip of XML, a reader process, or plain text. */
async function readKind(kind: DocKind, data: Uint8Array, as: ReadAs): Promise<Read> {
  const { options, maxChars } = as;
  if (kind === "pdf") {
    const result = await pdfText(data, {
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      maxChars,
      deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    });
    return { text: result.text, meta: { ...result.meta }, locators: result.locators };
  }
  if (kind === "docx") return { ...docxText(data, maxChars), locators: [] };
  if (kind === "xlsx") return xlsxText(data, maxChars);
  if (kind === "pptx") return pptxText(data, maxChars);
  if (kind === "odf") return { ...odfText(data, maxChars), locators: [] };
  if (kind === "epub") return { ...epubText(data, maxChars), locators: [] };
  if (kind === "calendar" || kind === "eml" || kind === "subtitles")
    return { ...(await readInProcess(kind, data, as)), locators: [] };
  return { ...readPlain(kind, data, maxChars), locators: [] };
}

/** The formats a library parses in a reader process of its own, killed at the deadline. */
async function readInProcess(
  kind: "calendar" | "eml" | "subtitles",
  data: Uint8Array,
  as: ReadAs,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  const ends = Date.now() + (as.options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  // A calendar is read whole or not at all (cut short, its last component never closes): `MAX_CALENDAR_BYTES` bounds it.
  if (kind === "calendar") return await calendarText(data, decodeText, ends);
  // A MIME message is read whole or not at all: cut short, its last part's encoding would be half a word.
  if (kind === "eml") return await emailText(data, ends);
  // Transcripts and subtitles: the input is capped at what a real transcript's markup needs, and parsed in the
  // reader's own process, which stops at `maxChars` of kept text or at the deadline (`subtitles.ts`).
  const { bytes, cut } = prefix(data, as.maxChars * SUBTITLE_BYTES_PER_CHAR);
  const read = await subtitlesText(decodeText(bytes), as.maxChars, ends);
  return cut ? { text: read.text, meta: { ...read.meta, truncated: true } } : read;
}

/**
 * Text, HTML and RTF. The caps are applied to the input, before decoding and tidying, and the cut is reported as
 * truncation, since what lies past it is not read.
 */
function readPlain(
  kind: DocKind,
  data: Uint8Array,
  maxChars: number,
): { text: string; meta: Record<string, unknown> } {
  const perChar = kind === "text" ? TEXT_BYTES_PER_CHAR : MARKUP_BYTES_PER_CHAR;
  const { bytes, cut } = prefix(data, maxChars * perChar);
  const text =
    kind === "html" ? htmlToText(bytes) : kind === "rtf" ? rtfToText(bytes) : decodeText(bytes);
  return { text, meta: cut ? { truncated: true } : {} };
}

/** A reader's failure as the answer about the file; a host that could not start a reader is rethrown. */
function refusal(kind: DocKind, error: unknown): DocText {
  // Not an answer about the file: the host could not start a reader. The caller retries, and counts nothing.
  if (error instanceof ReaderUnavailable) throw error;
  if (error instanceof DecompressionRefused) return refuse(kind, "too-large", error.message);
  if (error instanceof PdfDeadline) return refuse(kind, "timed-out", error.message);
  if (error instanceof CalendarDeadline) return refuse(kind, "timed-out", error.message);
  if (error instanceof CalendarRefused) return refuse(kind, "too-large", error.message);
  if (error instanceof EmailDeadline) return refuse(kind, "timed-out", error.message);
  if (error instanceof EmailRefused) return refuse(kind, "too-large", error.message);
  if (error instanceof SubtitlesDeadline) return refuse(kind, "timed-out", error.message);
  if (error instanceof SubtitlesRefused) return refuse(kind, "too-large", error.message);
  const message = error instanceof Error ? error.message : String(error);
  // pdf.js names this one: a password-protected file could be sent again unlocked, where a damaged one could not.
  if (/password|encrypt/i.test(message))
    return refuse(kind, "encrypted", "The file is password-protected");
  return refuse(kind, "damaged", `The file could not be read: ${message.slice(0, 200)}`);
}

/** The reading, tidied and cut at `maxChars` on a line ending; a locator the cut removed is dropped. */
function finished(kind: DocKind, read: Read, maxChars: number): DocText {
  const { text, meta, locators } = read;
  const cleaned = tidy(text);
  const truncated = cleaned.length > maxChars || meta.truncated === true;
  let out = cleaned;
  if (cleaned.length > maxChars) {
    // Cut at a line ending, so the last thing a reader sees is a whole sentence rather than half a word.
    const cut = out.lastIndexOf("\n", maxChars);
    out = out.slice(0, cut > maxChars / 2 ? cut : maxChars);
  }
  const { truncated: _ignored, ...rest } = meta;
  return {
    kind,
    readerVersion: readerVersionOf(kind),
    text: out,
    chars: out.length,
    truncated,
    meta: rest,
    locators: out.length === cleaned.length ? locators : shiftLocators(locators, 0, out.length),
  };
}

/**
 * Bytes of source a plain format may need per character kept: at most 4 for text (UTF-8), far more for markup. The
 * input is cut at this much before it is decoded and tidied, so a 32 MB log under a 400k cap decodes as 1.6 MB.
 */
const TEXT_BYTES_PER_CHAR = 4;

const MARKUP_BYTES_PER_CHAR = 24;

/**
 * The first `limit` bytes, ending on a character boundary, so half a character does not fail the UTF-8 decode and
 * drop the whole file to cp1252. A UTF-16 file (BOM FF FE or FE FF) is cut on an even byte.
 */
function prefix(data: Uint8Array, limit: number): { bytes: Uint8Array; cut: boolean } {
  if (data.byteLength <= limit) return { bytes: data, cut: false };
  let end = limit;
  const utf16 =
    data.byteLength >= 2 &&
    ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff));
  if (utf16) end -= end % 2;
  else while (end > 0 && ((data[end] ?? 0) & 0xc0) === 0x80) end--;
  return { bytes: data.subarray(0, end), cut: true };
}
