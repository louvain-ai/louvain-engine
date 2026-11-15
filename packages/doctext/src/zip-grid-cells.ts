/** One cell's value, read the same way by the text and by the grid. */
import { formatNumber } from "./numfmt.js";
import { xmlText } from "./xml.js";
import { type CellFormats, NO_FORMATS, serialText } from "./zip-cell-formats.js";
import { cachedValueOf } from "./zip-sheet-cells.js";

/** How a cell is read: as stored for the text, or `shown` through its number format for the grid a person reads. */
export type CellRead = { formats?: CellFormats; shown?: boolean };

/** One cell's value: the shared or inline string, the cached `<v>` (never the `<f>`), TRUE/FALSE, a date as ISO. */
export function cellValue(
  cell: { type: string | undefined; inner: string; style: string | undefined },
  shared: string[],
  read: CellRead = {},
): string {
  const { type, inner, style } = cell;
  const formats = read.formats ?? NO_FORMATS;
  const shown = read.shown ?? false;
  if (type === "s") {
    const index = Number(cachedValueOf(inner));
    return Number.isInteger(index) ? (shared[index] ?? "") : "";
  }
  if (type === "inlineStr") return xmlText(inner);
  const cached = xmlText(cachedValueOf(inner) ?? "");
  if (type === "b") return cached === "1" ? "TRUE" : cached === "0" ? "FALSE" : cached;
  if ((type === undefined || type === "n") && cached !== "" && style !== undefined) {
    const kind = formats.kinds[Number(style)];
    const serial = Number(cached);
    const code = shown ? formats.codes[Number(style)] : null;
    const drawn =
      code && Number.isFinite(serial) ? formatNumber(serial, code, formats.date1904) : null;
    if (drawn !== null) return drawn;
    if (kind && Number.isFinite(serial) && serial >= 0)
      return serialText(serial, kind, formats.date1904);
  }
  // `n` (or no type — a date serial included), `str`, `e` and `d` all carry
  // their display text in `<v>`; `<f>` is never read.
  return cached;
}
