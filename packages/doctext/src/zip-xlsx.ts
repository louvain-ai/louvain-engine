/**
 * A workbook as text a model reads, sheet by sheet and tab-separated, one locator per sheet. It reads each cell's
 * value, never its formula (a formula is not a fact anyone stated), and names each sheet, because which tab a
 * number sits on often carries its meaning.
 */
import { type DocLocator, LocatorTrail } from "./locator.js";
import { text, tidy } from "./plain.js";
import { xmlElements, xmlTagAttrs } from "./tag-elements.js";
import { xmlText } from "./xml.js";
import { readZip } from "./zip-archive.js";
import { type CellFormats, cellFormats } from "./zip-cell-formats.js";
import { cellValue } from "./zip-grid-cells.js";
import { attr, cellRef, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./zip-sheet-cells.js";
import { MAX_SHEETS, sharedStrings, sheetTargets, WORKBOOK_PARTS } from "./zip-sheet-parts.js";

/**
 * A workbook's text. At most `MAX_SHEETS` sheets, each part read once, the length kept running so the trail is
 * never joined to measure it; a sheet past `maxChars` is text the caller would throw away.
 */
export function xlsxText(data: Uint8Array, maxChars = Number.POSITIVE_INFINITY): XlsxText {
  const read = readZip(data, WORKBOOK_PARTS, maxChars);
  const files = read.files;
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) throw new Error("not a workbook: xl/workbook.xml is missing");
  const tables: CellTables = {
    shared: sharedStrings(files),
    formats: cellFormats(text(files.get("xl/styles.xml")), text(workbook)),
  };
  const targets = sheetTargets(files);
  const run: TextRun = {
    trail: new LocatorTrail(),
    names: [],
    length: 0,
    cells: 0,
    truncated: read.truncated,
  };
  const readParts = new Set<string>();
  let listed = 0;
  for (const tag of xmlTagAttrs(text(workbook), "sheet")) {
    const name = attr(tag, "name");
    const rid = attr(tag, "r:id");
    if (name === undefined || rid === undefined) continue;
    if (run.length >= maxChars || listed >= MAX_SHEETS) {
      run.truncated = true;
      break;
    }
    listed++;
    const title = xmlText(name);
    run.names.push(title);
    const sheet = unreadPart(files, targets.get(rid), readParts);
    const lines = [`## ${title}`, ...(sheet ? sheetRows(text(sheet), tables, run) : [])];
    finishSheet(run, lines, title);
  }
  return {
    text: run.trail.text(),
    meta: { sheets: run.names, cells: run.cells, truncated: run.truncated },
    locators: run.trail.locators(),
  };
}

type XlsxText = { text: string; meta: Record<string, unknown>; locators: DocLocator[] };

/** A sheet's part, or undefined when it is missing or another sheet already read it. */
function unreadPart(
  files: Map<string, Uint8Array>,
  target: string | undefined,
  readParts: Set<string>,
): Uint8Array | undefined {
  const fresh = target !== undefined && !readParts.has(target);
  if (target !== undefined) readParts.add(target);
  return fresh ? files.get(`xl/${target}`) : undefined;
}

type CellTables = { shared: string[]; formats: CellFormats };
type TextRun = {
  trail: LocatorTrail;
  names: string[];
  length: number;
  cells: number;
  truncated: boolean;
};

/** A sheet's text joins the trail tidied, so its locator's offsets are the final text's. */
function finishSheet(run: TextRun, lines: string[], title: string): void {
  const cleaned = tidy(lines.join("\n"));
  if (!cleaned) return;
  if (run.length > 0) {
    run.trail.gap("\n");
    run.length += 1;
  }
  run.trail.push(cleaned, { sheet: title });
  run.length += cleaned.length;
}

/** A sheet's rows as tab-separated lines; only a row that says something counts toward `MAX_SHEET_ROWS`. */
function sheetRows(xml: string, tables: CellTables, run: TextRun): string[] {
  const out: string[] = [];
  let rows = 0;
  for (const row of xmlElements(xml, "row")) {
    if (rows >= MAX_SHEET_ROWS) {
      run.truncated = true;
      break;
    }
    const values = rowValues(row.inner, tables);
    // Excel writes a formatted empty row as `<row r="5"/>`; counting those could cut real data off a sheet.
    if (values.length > 0) {
      out.push(values.join("\t"));
      run.cells += values.length;
      rows++;
    }
  }
  return out;
}

/**
 * A row's values, each in its own column (`r="C2"`), as the grid places them: a writer omits an empty cell, and
 * taking the next value for the next column would move every value after a gap one column left. A cell with no
 * reference takes the next column. Trailing empty cells are dropped.
 */
function rowValues(inner: string, tables: CellTables): string[] {
  const values: string[] = [];
  for (const cell of xmlElements(inner, "c")) {
    const col = cellRef(attr(cell.attrs, "r"))?.col ?? values.length;
    if (col >= MAX_SHEET_COLUMNS) break;
    while (values.length < col) values.push("");
    // One reading of a cell for the text and the grid (`cellValue`).
    values[col] = cellValue(
      { type: attr(cell.attrs, "t"), inner: cell.inner, style: attr(cell.attrs, "s") },
      tables.shared,
      { formats: tables.formats },
    );
  }
  while (values.length > 0 && values[values.length - 1] === "") values.pop();
  return values;
}
