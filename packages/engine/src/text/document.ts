import type { RecordView } from "@louvain/engine-core";
import { isObject } from "./words.js";

/**
 * Where a document's own text starts, and which of its lines are headings: what a passage's header and a document's
 * sections both read off a record's text. Pure, and the only part of `document.ts` the open indexer needs (a passage's
 * context, `ingest/passage-context.ts`); `document.ts` re-exports it.
 */

export function documentBlock(presentation: Record<string, unknown>): Record<string, unknown> {
  return isObject(presentation.document) ? presentation.document : {};
}

/** Where the document's own text starts inside the record's text. */
export function documentTextStart(record: Pick<RecordView, "text" | "presentation">): number {
  const offset = documentBlock(record.presentation).textOffset;
  return typeof offset === "number" &&
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset <= record.text.length
    ? offset
    : 0;
}

const MARKDOWN_HEADING = /^#{1,6}\s+\S.{0,120}$/;
/** "4.2 Payment terms", "II. Definitions", "b. Scope": a number (Arabic, Roman or a letter) and a title, in any case. */
const NUMBERED_HEADING =
  /^(?:\d{1,2}(?:\.\d{1,2}){0,3}\.?|[ivx]{1,5}\.|\p{L}\.)\s+\S[^.!?;]{0,90}$/iu;
const blank = (line: string | undefined): boolean => line === undefined || line.trim() === "";

/**
 * A heading is where a line stands, not how it is capitalised. A markdown heading says so itself. A numbered line
 * is a heading when it stands alone — a blank line (or the text's edge) on both sides — because a numbered LIST runs
 * item into item. A short unnumbered line (at most eight words, no closing punctuation) is a heading when it stands
 * alone AND a longer paragraph follows: a title above its section, not a sign-off at the end of a letter. Which case its
 * letters are in decides nothing: "SCHEDULE 1: FEES" and "schedule 1: fees" are the same heading. `lines[i]` is judged
 * with its neighbours; a line judged alone (`isHeading`) has none, so it stands alone.
 */
export function isHeadingAt(lines: readonly string[], i: number): boolean {
  const t = (lines[i] ?? "").trim();
  if (t.length < 3 || t.length > 120) return false;
  if (MARKDOWN_HEADING.test(t)) return true;
  const alone = blank(lines[i - 1]) && blank(lines[i + 1]);
  if (!alone) return false;
  if (NUMBERED_HEADING.test(t)) return true;
  if (t.split(/\s+/).length > 8 || /[.,;:!?]$/.test(t) || !/\p{L}/u.test(t)) return false;
  const following = lines.slice(i + 1).find((l) => !blank(l));
  return following !== undefined && following.trim().length >= Math.max(60, 2 * t.length);
}

/** One line on its own: a heading by its own shape (markdown, or numbered), with no neighbours to stand among. */
export function isHeading(line: string): boolean {
  const t = line.trim();
  return MARKDOWN_HEADING.test(t) || (t.length >= 3 && t.length <= 120 && NUMBERED_HEADING.test(t));
}
