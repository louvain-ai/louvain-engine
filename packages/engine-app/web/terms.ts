/**
 * What a query lights in a text. A query is read as identifiers (`SUP-1042`, lit whole), figures (`GBP 2,400`: the
 * whole figure is lit, whatever its thousands separator, and never a bare part of another number) and words (three
 * letters or more, not the small words every sentence has, lit where a word of the text starts with one). Accents and
 * case are ignored. Pure: text and ranges in, ranges out, the same in the browser and on the server.
 */

export type Range = { start: number; end: number };
export type Terms = { words: string[]; figures: string[]; ids: string[] };

const QUIET = new Set(
  "the and for are was were what when where which who why how does did has have had with this that from into about our you your".split(
    " ",
  ),
);
const EDGE = "(?<![\\p{L}\\p{N}])";
/** An identifier: letters and digits joined by a hyphen, slash, dot, colon or underscore, with a letter in it. */
const ID = /(?<![\p{L}\p{N}])[\p{L}\p{N}]+(?:[-_/.:#][\p{L}\p{N}]+)+/gu;
/** A figure: a currency sign, digits, groups of three after a separator, a decimal part. */
const FIGURE =
  /(?<![\p{L}\p{N}])(?:[£$€¥]\s?)?\d+(?:[,.  ' ]\d{3}(?!\d))*(?:[.,]\d+)?(?![\p{L}\p{N}])/gu;

/** Each character without its accents and in lower case, where that keeps its length: ranges stay the text's own. */
function fold(text: string): string {
  let out = "";
  for (const c of text) {
    const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === c.length ? f : c;
  }
  return out;
}

/** A figure's value as text: its digits, a decimal part kept apart. A group of exactly three digits is thousands. */
function figureKey(figure: string): string {
  const digits = figure.replace(/^[^\d]+/, "");
  const last = /[,.]?(\d+)$/.exec(digits);
  const decimal = last && /[.,]\d+$/.test(digits) && last[1]?.length !== 3 ? last[1] : null;
  const whole = decimal ? digits.slice(0, -(decimal.length + 1)) : digits;
  return whole.replace(/\D/g, "") + (decimal ? `.${decimal}` : "");
}

export function queryTerms(query: string): Terms {
  let rest = fold(query);
  const ids = [...rest.matchAll(ID)].map((m) => m[0]).filter((id) => /\p{L}/u.test(id));
  for (const id of ids) rest = rest.replace(id, " ");
  const figures = [...rest.matchAll(FIGURE)].map((m) => figureKey(m[0]));
  rest = rest.replace(FIGURE, " ");
  const words = (rest.match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !QUIET.has(w));
  return { words: [...new Set(words)], figures: [...new Set(figures)], ids: [...new Set(ids)] };
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the terms occur in `text`, in order, overlaps merged. */
export function termRanges(text: string, terms: Terms): Range[] {
  const folded = fold(text);
  const found: Range[] = [];
  const add = (m: RegExpMatchArray) =>
    found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  if (terms.ids.length > 0) {
    const ids = terms.ids.map(literal).join("|");
    for (const m of folded.matchAll(new RegExp(`${EDGE}(?:${ids})(?![\\p{L}\\p{N}])`, "gu")))
      add(m);
  }
  if (terms.words.length > 0) {
    const words = terms.words.map(literal).join("|");
    for (const m of folded.matchAll(new RegExp(`${EDGE}(?:${words})[\\p{L}\\p{N}]*`, "gu"))) add(m);
  }
  const figures = new Set(terms.figures);
  for (const m of figures.size ? text.matchAll(FIGURE) : [])
    if (figures.has(figureKey(m[0]))) add(m);
  return merged(found);
}

function merged(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges.sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
