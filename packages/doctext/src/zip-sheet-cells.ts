/**
 * The pieces every workbook read shares: a cell's reference, its cached value, attributes by name, and the size
 * the text and the grid stop at. Rows, cells and values are found by the linear tokenizer (`tags.ts`), never by a
 * pattern retried from every `<`.
 */
import { attrValue } from "./tag-attrs.js";
import { firstElement } from "./tag-elements.js";

/** The first `<v>`'s text in a cell's inner XML: the cached value. */
export const cachedValueOf = (inner: string): string | undefined => firstElement(inner, "v")?.inner;

/** A sheet has no natural end, so the rendering is bounded and a workbook that hits it says so. */
export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLUMNS = 64;

/** A tag's attribute by name, never by position: XML does not order them and writers do not agree. */
export const attr = attrValue;

/**
 * `r="AB12"` → { row: 11, col: 27 }, both 0-based; null when there is no
 * reference or it does not parse. Column letters are bijective base 26.
 */
export function cellRef(ref: string | undefined): { row: number; col: number } | null {
  if (!ref) return null;
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const letter of match[1] ?? "") col = col * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(match[2]);
  if (col < 1 || !Number.isInteger(row) || row < 1) return null;
  return { row: row - 1, col: col - 1 };
}
