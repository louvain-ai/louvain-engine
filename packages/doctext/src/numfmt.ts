/**
 * A number as its file formats it, for a person looking at the grid: literal prefixes and suffixes, thousands,
 * fixed or ranged decimals, percent, a trailing comma's scaling, positive;negative;zero sections and custom dates.
 * What it does not know (a condition, scientific, a fraction, `[h]`, text) is null and the caller keeps its value,
 * because a wrong format is worse than none. Only the grid uses this: the text a model reads keeps the stored value.
 */
import { drawDate, isDateSection } from "./numfmt-date.js";

/**
 * The built-in number formats a file names by id alone, as ECMA-376 §18.8.30 fixes them. Ids 5–8 and 23–36 are
 * locale-dependent (a currency, an Asian date) and are left out: drawn in one locale they would be wrong in
 * another. Built-in dates (14–22, 45–47) are read as ISO by the caller, which is unambiguous in every locale.
 */
export const BUILTIN_NUMBER_FORMATS: ReadonlyMap<number, string> = new Map([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
]);

/** The most decimals a code may ask for; past it the code is not one a person wrote. */
const MAX_DECIMALS = 20;

/** A code's sections, split on `;` outside quotes, escapes and brackets. */
export function sections(code: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "\\") i++;
    else if (c === '"') {
      const close = code.indexOf('"', i + 1);
      i = close < 0 ? code.length : close;
    } else if (c === "[") {
      const close = code.indexOf("]", i + 1);
      i = close < 0 ? code.length : close;
    } else if (c === ";") {
      out.push(code.slice(from, i));
      from = i + 1;
    }
  }
  out.push(code.slice(from));
  return out;
}

type Part = { literal: string } | { pattern: string };

/**
 * A section as literals and ONE run of digit placeholders (`0 # ? , .`), or null when it holds something this
 * does not draw. `%` is a literal that also multiplies; a bracket is a currency (`[$€-1809]` → "€"), a colour
 * (dropped) or anything else (null).
 */
function parts(section: string): { parts: Part[]; percent: number } | null {
  const out: Part[] = [];
  const run = { percent: 0, runs: 0, literal: "", pattern: "" };
  for (let i = 0; i < section.length; i++) {
    const c = section.charAt(i);
    // A placeholder, a separator inside the run, or a leading decimal point (`.00`) that starts it.
    if (
      "0#?".includes(c) ||
      (run.pattern && (c === "," || c === ".")) ||
      (c === "." && "0#?".includes(section.charAt(i + 1)))
    ) {
      if (!run.pattern) {
        flushLiteral(out, run);
        if (++run.runs > 1) return null;
      }
      run.pattern += c;
      continue;
    }
    flushPattern(out, run);
    const step = literalStep(section, i);
    if (!step) return null;
    run.literal += step.text;
    if (step.percent) run.percent++;
    i += step.skip;
  }
  flushPattern(out, run);
  flushLiteral(out, run);
  return { parts: out, percent: run.percent };
}

type Run = { percent: number; runs: number; literal: string; pattern: string };

function flushLiteral(out: Part[], run: Run): void {
  if (run.literal) out.push({ literal: run.literal });
  run.literal = "";
}

function flushPattern(out: Part[], run: Run): void {
  if (run.pattern) out.push({ pattern: run.pattern });
  run.pattern = "";
}

/** The literal text the character at `i` adds and how many more characters it consumes, or null for what this does not draw. */
function literalStep(
  section: string,
  i: number,
): { text: string; skip: number; percent: boolean } | null {
  const c = section.charAt(i);
  if (c === '"') {
    const close = section.indexOf('"', i + 1);
    if (close < 0) return null;
    return { text: section.slice(i + 1, close), skip: close - i, percent: false };
  }
  if (c === "\\") return { text: section.charAt(i + 1), skip: 1, percent: false };
  // Padding to a character's width, or a fill: neither is a character of the value.
  if (c === "_" || c === "*") return { text: "", skip: 1, percent: false };
  if (c === "[") {
    const close = section.indexOf("]", i + 1);
    if (close < 0) return null;
    const inner = section.slice(i + 1, close);
    if (inner.startsWith("$"))
      return { text: inner.slice(1).split("-")[0] ?? "", skip: close - i, percent: false };
    if (!/^(?:black|blue|cyan|green|magenta|red|white|yellow|color\s*\d+)$/i.test(inner))
      return null;
    return { text: "", skip: close - i, percent: false };
  }
  if (c === "%") return { text: c, skip: 0, percent: true };
  // Text, a fraction, scientific notation.
  if (c === "@" || c === "/" || /[eE]/.test(c)) return null;
  return { text: c, skip: 0, percent: false };
}

/** `digits` as a decimal string of `value` rounded half away from zero to `decimals`, or null past 1e21. */
function fixed(value: number, decimals: number): { int: string; dec: string } | null {
  // Rounded on 15 significant digits first, as a spreadsheet does, so 1.005 is 1.01 and not 1.00.
  const scaled = Math.round(Number((value * 10 ** decimals).toPrecision(15)));
  if (!Number.isFinite(scaled) || scaled >= 1e21) return null;
  const digits = String(scaled).padStart(decimals + 1, "0");
  return decimals === 0
    ? { int: digits, dec: "" }
    : { int: digits.slice(0, -decimals), dec: digits.slice(-decimals) };
}

function drawNumber(value: number, pattern: string, percent: number): string | null {
  // Commas closing the digits scale by a thousand each (`#,##0,` is thousands, `0.0,,` millions).
  let scale = 0;
  let digits = pattern;
  while (digits.endsWith(",")) {
    digits = digits.slice(0, -1);
    scale++;
  }
  let integer = digits;
  let decimal = "";
  const point = digits.indexOf(".");
  if (point >= 0) {
    integer = digits.slice(0, point);
    decimal = digits.slice(point + 1).replace(/,/g, "");
    while (integer.endsWith(",")) {
      integer = integer.slice(0, -1);
      scale++;
    }
  }
  const grouped = integer.includes(",");
  const intMin = (integer.match(/[0?]/g) ?? []).length;
  const decMin = (decimal.match(/[0?]/g) ?? []).length;
  const decMax = (decimal.match(/[0#?]/g) ?? []).length;
  if (decMax > MAX_DECIMALS) return null;
  const n = (value * 100 ** percent) / 1000 ** scale;
  const rounded = fixed(n, decMax);
  if (!rounded) return null;
  let { int, dec } = rounded;
  while (dec.length > decMin && dec.endsWith("0")) dec = dec.slice(0, -1);
  int = int.replace(/^0+/, "").padStart(intMin, "0");
  if (grouped) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return point >= 0 ? `${int}.${dec}` : int;
}

/**
 * `value` drawn by the number format `code`, or null when the code is General, text, or something this does not
 * draw faithfully (see the header) — the caller then keeps the value it had.
 */
export function formatNumber(value: number, code: string, date1904 = false): string | null {
  if (!Number.isFinite(value)) return null;
  const trimmed = code.trim();
  if (trimmed === "" || /^general$/i.test(trimmed)) return null;
  const all = sections(trimmed);
  // A conditional section (`[>=100]`) decides by a rule this does not evaluate.
  if (all.some((s) => /\[\s*[<>=]/.test(s))) return null;
  const negative = value < 0;
  let section = all[0] ?? "";
  let sign = negative ? "-" : "";
  if (all.length >= 2 && negative) {
    // A negative section draws its own sign (or parentheses): the value is its magnitude.
    section = all[1] ?? "";
    sign = "";
  } else if (all.length >= 3 && value === 0) section = all[2] ?? "";
  if (/general/i.test(section)) return null;
  if (isDateSection(section)) return negative ? null : drawDate(value, section, date1904);
  const parsed = parts(section);
  if (!parsed) return null;
  let out = "";
  let zero = true;
  for (const part of parsed.parts) {
    if ("literal" in part) {
      out += part.literal;
      continue;
    }
    const drawn = drawNumber(Math.abs(value), part.pattern, parsed.percent);
    if (drawn === null) return null;
    if (/[1-9]/.test(drawn)) zero = false;
    out += drawn;
  }
  // A value that rounds to nothing is not drawn as "-0".
  return (zero ? "" : sign) + out;
}
