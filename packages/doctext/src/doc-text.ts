/** What reading a file answers: its text and where each run came from, or why there is none. */
import type { DocKind } from "./classify.js";
import type { DocLocator } from "./locator.js";

/**
 * Why a file has no text. Each is an answer a caller records on the source,
 * never an error to retry: a `.doc` will still be a `.doc` next time, and a
 * caller that retried on it would never finish.
 */
export type DocTextReason =
  | "unsupported-format"
  | "legacy-office"
  | "encrypted"
  | "too-large"
  /** A PDF that could not even be opened within the deadline. One that opened keeps the pages it read. */
  | "timed-out"
  | "empty"
  | "damaged";

export type DocText = {
  kind: DocKind;
  /** The extracted text, tidied. Empty when `reason` is set. */
  text: string;
  chars: number;
  /** Set when the file's text was cut at a cap rather than ending. */
  truncated: boolean;
  /** Absent on success. */
  reason?: DocTextReason;
  /** What the caller may tell a person: short, specific, never a stack. */
  detail?: string;
  /** Per-format facts worth keeping on the source: page count, sheet names. */
  meta: Record<string, unknown>;
  /** The version of this kind's reader that made the reading (`versions.ts`): what a later reader re-reads. */
  readerVersion: number;
  /**
   * Where each run of `text` came from: page, sheet or slide. Only
   * a paginated format has them: a `.docx` or a text file is one flow, so the
   * character offset is already the locator. Empty when there is no text.
   */
  locators: DocLocator[];
};

export type ExtractOptions = {
  filename?: string | undefined;
  mimeType?: string | undefined;
  /**
   * The largest file worth reading. Past it the answer is `too-large`, a
   * fact about the source and not a failure: a metered unit has to be
   * bounded in size, and a huge video should cost one recorded outcome
   * rather than the process's memory.
   */
  maxBytes?: number | undefined;
  /**
   * The most text one file may contribute. Well below the ingest contract's
   * `MAX_EVENT_TEXT_CHARS` (2,000,000), because the caller still has to fit an
   * envelope, a filename and a mail's own body around this.
   */
  maxChars?: number | undefined;
  /** Pages of a PDF read at most (`DEFAULT_MAX_PAGES`). */
  maxPages?: number | undefined;
  /**
   * Wall-clock time a PDF may take (`DEFAULT_DEADLINE_MS`). A PDF is the one
   * format read asynchronously page by page, and a hostile one can make each
   * page expensive; past the deadline the pages already read are kept and the
   * text is marked truncated. The zip formats are bounded by size instead
   * (`ZIP_LIMITS`), because their read is synchronous and a timer cannot
   * interrupt it — which is exactly why their limits are checked before it starts.
   */
  deadlineMs?: number | undefined;
};
