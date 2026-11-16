import type { Range } from "./terms.js";

/**
 * Words on the page: where a search's passage sits in its whole document, and how a document's lines become
 * paragraphs. All of it is text and ranges, and runs anywhere.
 */

/** The text with every run of space made one, and where each of its characters sits in the original. */
function squeeze(text: string): { squeezed: string; at: number[] } {
  const at: number[] = [];
  let squeezed = "";
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text[i] ?? "");
    if (space && (squeezed.endsWith(" ") || squeezed === "")) continue;
    squeezed += space ? " " : text[i];
    at.push(i);
  }
  return { squeezed, at };
}

/**
 * Where a search's passage sits in the document. The passage is the document's words with every run of space made
 * one, and may end in "…", so both are compared that way. The whole passage is tried first, then windows of it in
 * turn, and the first that occurs once places it: a passage of repeated words can match at its opening many times.
 */
export function locate(text: string, passage: string): Range | null {
  const { squeezed, at } = squeeze(text);
  const needle = passage.replace(/…$/, "").replace(/\s+/g, " ").trim();
  const span = (start: number): Range => ({
    start: at[Math.max(0, start)] ?? 0,
    end: (at[Math.min(start + needle.length, at.length) - 1] ?? 0) + 1,
  });
  const probes = [{ from: 0, words: needle }];
  for (let from = 0; from + 40 <= needle.length; from += 80)
    probes.push({ from, words: needle.slice(from, from + 80) });
  let first: number | null = null;
  for (const { from, words } of needle ? probes : []) {
    const found = squeezed.indexOf(words);
    if (found < 0) continue;
    if (squeezed.indexOf(words, found + 1) < 0) return span(found - from);
    first ??= found - from;
  }
  return first === null ? null : span(first);
}

/**
 * A document's paragraphs, as ranges of its text: a blank line ends one. A line broken short of the measure keeps its
 * break (an address, a list); prose a file wrapped by hand at a fixed width flows as one paragraph again.
 */
export function paragraphs(text: string): Range[] {
  const out: Range[] = [];
  for (const block of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)) {
    if (block[0].trim()) out.push({ start: block.index, end: block.index + block[0].length });
  }
  return out;
}

/** Each line break after a line as long as a hand-wrapped measure becomes a space; the length never changes. */
export const unwrap = (text: string): string => text.replace(/^(.{64,})\n(?=\S)/gm, "$1 ");

/** A day as a row shows it: "3 Mar", and the year only when it is not this one. */
export function shortDay(iso: string | null): string {
  if (!iso) return "Undated";
  const day = new Date(iso);
  const thisYear = day.getFullYear() === new Date().getFullYear();
  return day.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

export function formatDay(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
