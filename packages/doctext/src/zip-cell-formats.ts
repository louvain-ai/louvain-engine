/**
 * A cell's format, read from `styles.xml`: whether a number is a date (a workbook stores a date as a serial and says
 * so only through the cell's style), the code a person sees it through, whether it wraps, and how it looks. A
 * numeric cell whose format is a date or a time reads as ISO; every other number is left as written.
 */
import { type CellLook, cellLooks } from "./looks.js";
import { BUILTIN_NUMBER_FORMATS } from "./numfmt.js";
import { firstElement, xmlElements, xmlTagAttrs } from "./tag-elements.js";
import { xmlText } from "./xml.js";
import { attr } from "./zip-sheet-cells.js";

type DateKind = "date" | "time" | "datetime";
/**
 * Per `cellXfs` entry (a cell's `s`): whether its format is a date (`kinds`, read by the text and the grid), the
 * number format code a person sees it through (`codes`, grid only: `numfmt.ts`), whether it wraps its text (`wrap`,
 * `<alignment wrapText="1">`, grid only), and how it looks (`looks`: font, fill, borders, alignment; `looks.ts`, grid
 * only).
 */
export type CellFormats = {
  kinds: (DateKind | null)[];
  codes: (string | null)[];
  wrap: boolean[];
  looks: (CellLook | null)[];
  date1904: boolean;
};
export const NO_FORMATS: CellFormats = {
  kinds: [],
  codes: [],
  wrap: [],
  looks: [],
  date1904: false,
};
const BUILTIN_DATE: ReadonlyMap<number, DateKind> = new Map<number, DateKind>([
  ...[14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58].map(
    (id) => [id, "date"] as const,
  ),
  ...[18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56].map((id) => [id, "time"] as const),
  [22, "datetime"],
]);

function formatKind(code: string): DateKind | null {
  // What is printed literally — quoted text, an escaped character, a [colour] or [$-locale] section — is not a token.
  const tokens = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase();
  const time = /[hs]/.test(tokens);
  const date = /[yd]/.test(tokens) || (/m/.test(tokens) && !time);
  return date && time ? "datetime" : date ? "date" : time ? "time" : null;
}

export function cellFormats(styles: string, workbook: string, theme = ""): CellFormats {
  const custom = new Map<number, { kind: DateKind | null; code: string }>();
  for (const fmt of xmlTagAttrs(styles, "numFmt")) {
    const id = Number(attr(fmt, "numFmtId"));
    const code = attr(fmt, "formatCode");
    if (Number.isInteger(id) && code !== undefined) {
      const decoded = xmlText(code);
      custom.set(id, { kind: formatKind(decoded), code: decoded });
    }
  }
  const kinds: (DateKind | null)[] = [];
  const codes: (string | null)[] = [];
  const wrap: boolean[] = [];
  // Every `<xf>` in `cellXfs`, self-closing or holding an `<alignment>`, is one index a cell's `s` names.
  for (const xf of xmlElements(firstElement(styles, "cellXfs")?.inner ?? "", "xf")) {
    const id = Number(attr(xf.attrs, "numFmtId") ?? 0);
    const own = custom.get(id);
    kinds.push(own ? own.kind : (BUILTIN_DATE.get(id) ?? null));
    codes.push(own ? own.code : (BUILTIN_NUMBER_FORMATS.get(id) ?? null));
    const alignment = xf.selfClosing ? undefined : xmlTagAttrs(xf.inner, "alignment").next().value;
    const wrapText = alignment === undefined ? undefined : attr(alignment, "wrapText");
    wrap.push(wrapText === "1" || wrapText === "true");
  }
  const flag = attr(xmlTagAttrs(workbook, "workbookPr").next().value ?? "", "date1904");
  return {
    kinds,
    codes,
    wrap,
    looks: cellLooks(styles, theme),
    date1904: flag === "1" || flag === "true",
  };
}

export function serialText(serial: number, kind: DateKind, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const iso = new Date(epoch + Math.round(serial * 86_400_000)).toISOString();
  const day = iso.slice(0, 10);
  const clock = iso.slice(11, 19).replace(/:00$/, "");
  return kind === "date" ? day : kind === "time" ? clock : `${day} ${clock}`;
}
