/**
 * The cut: a text into the passages it is written as. Messages are short, so most become one passage; long ones split
 * on sentence boundaries with a small overlap, so a fact spanning a break is still retrievable whole from one chunk.
 */
import type { PassageRules } from "./passage-rules.js";

/** A text's passages: each part the build cuts on its own (`passage-rules.ts`), in order. Nothing is dropped. */
export function chunk(rules: PassageRules, text: string): string[] {
  return rules.parts(text).flatMap(chunkOne);
}

/** The length a passage aims at: longer gives a hit more context, shorter ranks more finely. */
const TARGET = 900;
/** What each split repeats of the passage before it, so a fact across the break is whole in one of them. */
const OVERLAP = 120;
/** The longest piece an over-long sentence is cut into (`withinTarget`). */
const PIECE = TARGET - OVERLAP;

function chunkOne(text: string): string[] {
  // Each run of whitespace becomes ONE character, a line break where the run held one, so a sentence too long to be
  // a passage can still be cut where its lines end. Every chunk is written with single spaces.
  const clean = text.replace(/\s+/g, (run) => (run.includes("\n") ? "\n" : " ")).trim();
  if (clean.length <= TARGET) return clean.length > 0 ? [clean.replaceAll("\n", " ")] : [];

  const sentences = (clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean]).flatMap(withinTarget);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > TARGET && cur.length > 0) {
      out.push(cur.trim().replaceAll("\n", " "));
      // The overlap starts on a word, never inside one, so no passage opens mid-word.
      const start = Math.max(0, cur.length - OVERLAP);
      const tail = cur.slice(start);
      cur = start > 0 && /\S/.test(cur[start - 1] ?? "") ? tail.replace(/^\S*\s*/, "") : tail;
    }
    cur += s;
  }
  if (cur.trim().length > 0) out.push(cur.trim().replaceAll("\n", " "));
  return out;
}

/**
 * A sentence longer than a passage is cut at its lines, then between words: text with no sentence ends (a sheet) would
 * otherwise be one passage. Each piece keeps its break at its end, so the pieces rejoin exactly, and is at most
 * `PIECE`, so with the overlap in front of it a chunk stays within `TARGET`.
 */
function withinTarget(sentence: string): string[] {
  if (sentence.length <= TARGET) return [sentence];
  const pieces: string[] = [];
  for (const line of sentence.match(/[^\n]*\n|[^\n]+$/g) ?? [sentence]) {
    let rest = line;
    while (rest.length > PIECE) {
      const space = rest.lastIndexOf(" ", PIECE - 1);
      const at = space >= PIECE / 2 ? space + 1 : PIECE;
      pieces.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    if (rest.length > 0) pieces.push(rest);
  }
  return pieces;
}
