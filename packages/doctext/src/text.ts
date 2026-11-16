import { decodeHTML, replaceCodePoint } from "entities/decode";

/**
 * Text as a person reads it, at the boundary where it arrives.
 *
 * A source's text is stored verbatim — the passage tier is the source's own
 * words — but a character REFERENCE is not a word: `&#160;` is a space that
 * was encoded for transport, and mailers pad a preview line with hundreds of
 * `&#847;&zwnj;` pairs (a combining grapheme joiner and a zero-width
 * non-joiner) so the client shows nothing. Undecoded, every source card and
 * every reader window showed the encoding instead of the text; decoded
 * literally, the padding is a page of invisible characters. So references
 * become characters, the invisible ones become nothing, and an unknown named
 * reference is left as written rather than guessed.
 */

/**
 * Where the engine's reading of a reference differs from HTML's, on purpose: a no-break or typographic space is a
 * space (a passage is searched and cited as words, and a U+00A0 splits nothing), and a joiner, a soft hyphen or a
 * direction mark is nothing. Every other reference is HTML's own (`entities`, all 2,231 named ones).
 */
const OURS: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "",
  zwj: "",
  zwsp: "",
  shy: "",
  lrm: "",
  rlm: "",
};
/** Zero-width and joining characters that carry no text. */
export const INVISIBLE = /[\u034F\u200B-\u200D\u2060\uFEFF\u00AD]/g;
/** A code point a string can hold on its own: in range, and not half of a surrogate pair. */
const scalar = (code: number): string =>
  code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : "";
/** One reference: numeric, or a name with or without its `;` (HTML's legacy forms, `&nbsp`, `&amp`). */
// Digits are not capped: a capped run would decode `&#99999999;` as `&#9999999` and leave `9;` behind.
const REFERENCE = /&(?:#(x[0-9a-f]+|[0-9]+)|([a-z][a-z0-9]{1,31}));?/gi;
/**
 * Character references to characters, in ONE pass (`entities`, HTML's own table and rules). It was a chain of
 * replaces over a 27-name table: `&eacute;` and every other name it lacked stayed literal in mail, pages and books
 * (and the verifier then matched text nobody wrote), `&#146;` became the C1 control U+0092 rather than the ’ HTML
 * reads it as (Windows-1252 in a numeric reference), so an Outlook apostrophe vanished, and `&#38;lt;` was decoded
 * twice into `<`. A numeric reference is mapped as HTML maps it and dropped when it names no character; an unknown
 * name is left as written.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(REFERENCE, (ref: string, numeric?: string, name?: string) => {
      if (numeric !== undefined) {
        const code =
          numeric[0] === "x" || numeric[0] === "X"
            ? Number.parseInt(numeric.slice(1), 16)
            : Number(numeric);
        const mapped = replaceCodePoint(code);
        return mapped === 0xfffd && code !== 0xfffd ? "" : scalar(mapped);
      }
      const lower = (name ?? "").toLowerCase();
      if (ref.endsWith(";")) {
        const ours = OURS[lower];
        if (ours !== undefined) return ours;
      } else {
        // A legacy name runs into the word after it (`&nbspb`): ours when it is one of the two HTML accepts bare.
        for (const bare of ["nbsp", "shy"])
          if (lower.startsWith(bare)) return (OURS[bare] ?? "") + (name ?? "").slice(bare.length);
      }
      return decodeHTML(ref);
    })
    .replace(INVISIBLE, "")
    .replace(/[ \t]{2,}/g, " ");
}
/** Tags whose CONTENT is not text: dropped with the tag, not just the markup. */
const DROPPED = ["style", "script"] as const;
/** Tags whose end is a line end to a reader. */
const BLOCK_END = /^(br\s*\/?|\/p|\/div|\/tr|\/li|\/h[1-6])$/i;
const PUNCTUATION = new Set([",", ".", ";", ":", "!", "?"]);
const SPACE = /\s/;
const isSpace = (c: string): boolean => SPACE.test(c);
/**
 * Whitespace directly before punctuation goes: `word ,` reads `word,`. A loop
 * rather than `\s+([,.;:!?])`, which retried a whitespace run from every
 * position inside it and was quadratic in the run's length.
 */
function tightenPunctuation(text: string): string {
  // Kept text is copied as whole runs (`slice`), never a character at a time: a string built by a million `+=` is a
  // million-node rope, and flattening it grew faster than the input on a shared CI runner.
  const parts: string[] = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    if (!isSpace(text[i] as string)) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && isSpace(text[j] as string)) j++;
    if (j < text.length && PUNCTUATION.has(text[j] as string)) {
      parts.push(text.slice(from, i));
      from = j;
    }
    i = j;
  }
  parts.push(text.slice(from));
  return parts.join("");
}
/**
 * HTML to text, keeping the line structure a person wrote.
 *
 * It is the fallback for a mail with no plain part, and the document
 * reader's for HTML met as an attachment, as a `.html` in a shared drive
 * and as every chapter of an EPUB — and two slightly different definitions of
 * "what counts as a line break" is how a citation stops matching the text it
 * cites. Block ends become newlines because that is what a reader sees; every
 * other tag becomes a space, because `a<b>c</b>d` is three words, not one.
 *
 * One pass, linear in the input. It was four regular expressions, and three of
 * them backtracked on text a source controls: `<style[\s\S]*?<\/style>` with
 * no closing tag rescanned to the end from every `<style`, `<[^>]+>` did the
 * same from every `<` with no `>` after it, and the punctuation rule retried
 * every whitespace run from each of its positions — measured, 4.5 s on 120 KB.
 * A search that has already failed to find a closing `>` or `</style>` is
 * remembered, so no later position repeats it.
 */
export function stripHtml(html: string): string {
  // Case-insensitive searches by pattern, not over `html.toLowerCase()`: a
  // lower-cased copy is not always the same length (`İ` becomes two code
  // units), so its indices would not be the original's.
  const closers = { style: /<\/style>/gi, script: /<\/script>/gi };
  // Text is copied in whole runs from `from`; a `<` that is not a tag stays in its run. Built as parts and joined
  // once, never a character at a time (see `tightenPunctuation`).
  const parts: string[] = [];
  let from = 0;
  let i = 0;
  /** Past this index there is no `>` at all. */
  let noCloseAngleFrom = Number.POSITIVE_INFINITY;
  const noClosingTagFrom: Record<(typeof DROPPED)[number], number> = {
    style: Number.POSITIVE_INFINITY,
    script: Number.POSITIVE_INFINITY,
  };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    // A dropped element: the whole of it, tag and content, when it is closed. Both names start with `s`, so any
    // other `<` is not compared at all.
    const first = html.charCodeAt(lt + 1) | 0x20;
    const dropped =
      first === 0x73
        ? DROPPED.find((name) => html.slice(lt + 1, lt + 1 + name.length).toLowerCase() === name)
        : undefined;
    if (dropped) {
      const closer = closers[dropped];
      closer.lastIndex = lt;
      const found = lt >= noClosingTagFrom[dropped] ? null : closer.exec(html);
      if (found) {
        parts.push(html.slice(from, lt), " ");
        i = found.index + found[0].length;
        from = i;
        continue;
      }
      noClosingTagFrom[dropped] = Math.min(noClosingTagFrom[dropped], lt);
    }
    const gt = lt >= noCloseAngleFrom ? -1 : html.indexOf(">", lt + 1);
    if (gt === -1 || gt === lt + 1) {
      if (gt === -1) noCloseAngleFrom = Math.min(noCloseAngleFrom, lt);
      // Not a tag (`a < b`, or `<>`): the character is text, and stays in the run.
      i = lt + 1;
      continue;
    }
    parts.push(
      html.slice(from, lt),
      gt - lt <= 16 && BLOCK_END.test(html.slice(lt + 1, gt)) ? "\n" : " ",
    );
    i = gt + 1;
    from = i;
  }
  parts.push(html.slice(from));
  const out = parts.join("");
  return tightenPunctuation(decodeEntities(out).replace(/[ \t]{2,}/g, " "))
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
