import { stripHtml } from "./text.js";

/**
 * Bytes to a string, without a charset-detection dependency. A BOM is evidence and is checked first; then UTF-8,
 * which almost everything is; then cp1252, which a legacy CSV is; then latin-1, which cannot fail. So a file is never
 * dropped for its encoding: the wrong single-byte codec costs an accent, a dropped document costs every answer.
 */
export function decodeText(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
    return new TextDecoder("utf-8").decode(data.subarray(3));
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder("utf-16be").decode(data.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    // cp1252 is the common alternative and a superset of latin-1 over the printable range.
    try {
      return new TextDecoder("windows-1252").decode(data);
    } catch {
      return new TextDecoder("latin1").decode(data);
    }
  }
}

/** A member's bytes as text, or "" when the member is missing. */
export const text = (bytes: Uint8Array | undefined): string => (bytes ? decodeText(bytes) : "");

/**
 * Tidy without destroying structure: newlines and tabs are the only structure these formats keep (a newline is a
 * paragraph, a tab a table cell, so a row stays one line), so both survive, and three blank lines collapse to one.
 * The text must also be storable: NUL and the other C0 controls (pdf.js emits U+0000 for unmapped glyphs) and lone
 * surrogates fail Postgres's `jsonb`, so they are removed here, where every reader's text passes.
 */
export function tidy(text: string): string {
  return (
    text
      // Not text, and not storable: NUL and its C0 neighbours (tab, newline, return excepted), and lone surrogates.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
      .replace(/\r\n?/g, "\n")
      // Every horizontal space that is not a tab, the non-breaking one between a figure and its unit included.
      .replace(/[^\S\n\t]+/g, " ")
      .replace(/ *\t */g, "\t")
      .replace(/ *\n */g, "\n")
      // Trailing empty cells at the end of a row say nothing.
      .replace(/\t+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** HTML to text, through the one definition of it (`@louvain/engine-core`). */
export function htmlToText(data: Uint8Array | string): string {
  return stripHtml(typeof data === "string" ? data : decodeText(data));
}

/** Destinations whose content is machine state, not text (`\*\` marks one a reader may not understand). */
const RTF_DROP = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "info",
  "pict",
  "object",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "xmlnstbl",
  "mmathPr",
  "filetbl",
  "revtbl",
  "protusertbl",
  "upr",
]);

const RTF_DESTINATION = /^\{\\(?:\*\\)?([a-z]+)/i;

/**
 * RTF to text: the literal text, with the groups known not to be prose dropped, the escapes that carry characters
 * resolved and every other control word discarded. Groups nest, so they are dropped by depth, never by a pattern
 * that stops at the first `}`. `\'xx` is read as cp1252, since the format is nearly always written on Windows.
 */
export function rtfToText(input: Uint8Array | string): string {
  const raw = typeof input === "string" ? input : decodeText(input);
  const out: string[] = [];
  let depth = 0;
  // The depth of the group currently being dropped, or null.
  let dropping: number | null = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === undefined) break;
    if (char === "{") {
      depth++;
      if (dropping === null) {
        const destination = RTF_DESTINATION.exec(raw.slice(i, i + 40))?.[1];
        if (destination && RTF_DROP.has(destination.toLowerCase())) dropping = depth;
      }
      continue;
    }
    if (char === "}") {
      if (dropping !== null && depth === dropping) dropping = null;
      depth--;
      continue;
    }
    if (dropping !== null) continue;
    if (char !== "\\") {
      out.push(char);
      continue;
    }
    const last = rtfEscape(raw, i, out);
    if (last < 0) break;
    i = last;
  }
  return out.join("");
}

/** The escape a backslash at `i` opens: what it adds to `out`, and the index of its last character (-1 at the end). */
function rtfEscape(raw: string, i: number, out: string[]): number {
  const next = raw[i + 1];
  if (next === undefined) return -1;
  if (next === "\\" || next === "{" || next === "}") {
    out.push(next);
    return i + 1;
  }
  if (next === "'") {
    const code = Number.parseInt(raw.slice(i + 2, i + 4), 16);
    if (!Number.isNaN(code)) out.push(CP1252[code] ?? String.fromCharCode(code));
    return i + 3;
  }
  // A control word: letters, an optional signed number, and an optional single trailing space that belongs to it.
  const match = /^([a-z]+)(-?\d+)? ?/i.exec(raw.slice(i + 1));
  if (!match?.[1]) return i + 1;
  const word = match[1];
  let last = i;
  if (word === "par" || word === "line" || word === "row" || word === "sect") out.push("\n");
  else if (word === "tab" || word === "cell") out.push("\t");
  else if (word === "u") {
    const code = Number(match[2]);
    if (Number.isFinite(code)) out.push(String.fromCodePoint(code < 0 ? code + 65536 : code));
    // The replacement character a `\uN` carries for readers that cannot.
    if (raw.slice(i + 1 + match[0].length).startsWith("?")) last += 1;
  }
  return last + match[0].length;
}

/** The cp1252 codepoints that differ from latin-1, for `\'xx`. */
const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};
