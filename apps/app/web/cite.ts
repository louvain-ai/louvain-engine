/**
 * Where a citation sits. An answer writes a ref in square brackets, `[ab12cd34ef]` or several, `[ab12, cd34]`; the
 * page draws each as a numbered chip directly after the punctuation that ends the claim it supports ("the lab.[1]"),
 * with no space before that punctuation and none between chips, the chips held to the word before them so a line
 * never starts with one. A bracket naming any ref this answer was not given stays text, as written. Pure text in,
 * pieces out: the page makes the chips.
 */

export type Piece = string | { glue: string; refs: string[] };

const REF = "[a-z0-9]{4,32}";
const BRACKET = `\\[\\s*${REF}(?:\\s*,\\s*${REF})*\\s*\\]`;
/** A run of brackets, the space before each, and the closing punctuation after the run. */
const RUN = new RegExp(`(?:\\s*${BRACKET})+[.,;:!?)”’»]*`, "gi");
const REFS = new RegExp(REF, "gi");
const CLOSING = /[.,;:!?)”’»]*$/;

/** A text's citations of the refs `known` holds, placed; everything else is the text as written. */
export function citations(text: string, known: (ref: string) => boolean): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(RUN)) {
    const punctuation = CLOSING.exec(m[0])?.[0] ?? "";
    const brackets = m[0].slice(0, m[0].length - punctuation.length);
    const refs = [...brackets.matchAll(REFS)].map((r) => r[0].toLowerCase());
    if (!refs.every(known)) continue;
    const before = text.slice(at, m.index);
    const cut = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
    out.push(before.slice(0, cut), { glue: before.slice(cut) + punctuation, refs });
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out.filter((p) => p !== "");
}

/** While an answer is written, a citation not yet closed is held back rather than shown half-typed. */
export const withoutOpenCitation = (text: string): string =>
  text.replace(/\s*\[[a-z0-9,\s]*$/i, "");
