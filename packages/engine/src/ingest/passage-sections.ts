import { documentTextStart, isHeadingAt } from "../text/document.js";
import { clip } from "../text/words.js";
import type { HeaderRecord } from "./passage-context.js";

/**
 * Where a passage sits in its record, for its header (`passage-context.ts`): the record's headings and the section
 * path at an offset, and where each chunk starts and centres.
 */

const HEADING_CHARS = 80;

/** How deep a heading sits: markdown's `#` count, a numbered heading's number groups, else the top. */
function headingLevel(line: string): number {
  const t = line.trim();
  const hashes = /^(#{1,6})\s/.exec(t);
  if (hashes) return (hashes[1] as string).length;
  const numbered = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s/.exec(t);
  if (numbered) return (numbered[1] as string).split(".").length;
  return 1;
}

type Heading = { at: number; level: number; title: string };

/** The record's headings in order, with where each starts in its text. */
export function headingsOf(record: HeaderRecord): Heading[] {
  const start = documentTextStart(record);
  const out: Heading[] = [];
  let at = start;
  const lines = record.text.slice(start).split("\n");
  for (const [i, line] of lines.entries()) {
    if (isHeadingAt(lines, i)) {
      out.push({
        at,
        level: headingLevel(line),
        title: clip(line.trim().replace(/^#{1,6}\s+/, ""), HEADING_CHARS),
      });
    }
    at += line.length + 1;
  }
  return out;
}

/** The section path at an offset: the headings above it, each replacing any at its own depth or deeper. */
export function pathAt(headings: readonly Heading[], offset: number): string[] {
  const stack: Heading[] = [];
  for (const h of headings) {
    if (h.at > offset) break;
    while (stack.length > 0 && (stack[stack.length - 1] as Heading).level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack.map((h) => h.title);
}

/**
 * Where each chunk starts in the record's text, and where its middle is. `chunk` collapses whitespace, so a chunk
 * is not a substring of the text; it IS a substring of the text with its whitespace collapsed, and chunks come in
 * text order (each part cut on its own after the one before it, overlaps starting before the previous chunk ends),
 * so each is found by a forward search from just past the previous one's start. A chunk not found has no place and
 * gets no section — never a guessed one.
 */
export function chunkPlaces(
  text: string,
  chunks: readonly string[],
): ({ start: number; mid: number } | null)[] {
  let normal = "";
  const origin: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      space = normal.length > 0;
      continue;
    }
    if (space) {
      normal += " ";
      origin.push(i);
      space = false;
    }
    normal += ch;
    origin.push(i);
  }
  let from = 0;
  return chunks.map((c) => {
    const probe = c.slice(0, 80);
    if (probe.length === 0) return null;
    const at = normal.indexOf(probe, from);
    if (at < 0) return null;
    from = at + 1;
    const start = origin[at];
    const mid = origin[Math.min(origin.length - 1, at + Math.floor(c.length / 2))];
    return start === undefined || mid === undefined ? null : { start, mid };
  });
}
