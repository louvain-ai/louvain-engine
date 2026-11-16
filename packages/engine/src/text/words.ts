import { createHash } from "node:crypto";
import type { Span } from "@louvain/engine-core";

/**
 * Small pure helpers every mailbox package shares: finding a model's quote in the record, comparing
 * names and values, reading dates, and reading a model's JSON reply without trusting it.
 */

// ———————————————————————————— quotes → spans ————————————————————————————

/** What a model changes when it "copies" text: runs of whitespace, curly quotes, dashes, ellipses. */
function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’" || ch === "‚" || ch === "′") return "'";
  if (ch === "“" || ch === "”" || ch === "„" || ch === "″") return '"';
  if (ch === "–" || ch === "—" || ch === "‑") return "-";
  return ch;
}

/** The text folded, with each folded character's offset in the original. Whitespace runs collapse to one. */
function folded(text: string, from = 0, to = text.length): { chars: string; offsets: number[] } {
  let chars = "";
  const offsets: number[] = [];
  let lastSpace = false;
  for (let i = from; i < to; i += 1) {
    const f = foldChar(text[i] as string);
    if (f === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else lastSpace = false;
    chars += f;
    offsets.push(i);
  }
  return { chars, offsets };
}

/**
 * Where a quote sits in the record, found by code — never taken from the model.
 *
 * Exact first; then with whitespace collapsed and typographic quotes and dashes folded, which is what a
 * model changes when it copies a sentence out of a wrapped mail. Searched only inside `within` (the
 * message's own words), so a quote from quoted history or an earlier message is not found. Returns null
 * when the quote is not there: the caller drops the statement rather than citing text nobody wrote.
 */
export function locateQuote(text: string, quote: string, within?: Span): Span | null {
  const from = within?.start ?? 0;
  const to = within?.end ?? text.length;
  const q = quote.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  if (q.length === 0) return null;
  const exact = text.slice(from, to).indexOf(q);
  if (exact >= 0) return { start: from + exact, end: from + exact + q.length };
  const hay = folded(text, from, to);
  const needle = folded(q).chars.trim();
  if (needle.length === 0) return null;
  const at = hay.chars.indexOf(needle);
  if (at < 0) return null;
  const start = hay.offsets[at] as number;
  const last = hay.offsets[at + needle.length - 1] as number;
  return { start, end: last + 1 };
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * A step's fingerprint for the ledger: a hash of its prompt text and of the functions that build the model's turn,
 * so an edited prompt or turn is a new run rather than a cached answer to the old one.
 */
export function fingerprint(...parts: (string | ((...args: never[]) => unknown))[]): string {
  const hash = createHash("sha256");
  for (const part of parts)
    hash.update(typeof part === "string" ? part : part.toString()).update("\0");
  return hash.digest("hex").slice(0, 16);
}
