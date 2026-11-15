/**
 * The building blocks a reader or a view is made from: the XML walk and its tags, the bounded archive, a cell's value
 * and format, number formats, and the reader process pool. Each is the same function the text readers use, so a view
 * built from them is bounded exactly as a reading is.
 */
export { classifyFile, LEGACY_NOTE, noReaderFor } from "./file-kind.js";
export { type CellLook, cellLooks } from "./looks.js";
export { formatNumber, sections } from "./numfmt.js";
export { decodeText, text, tidy } from "./plain.js";
export { type CueOptions, parseCues } from "./subtitles-cues.js";
export { type Turn, turnsOf } from "./subtitles-turns.js";
export { attrValue } from "./tag-attrs.js";
export { firstElement, xmlElements, xmlTagAttrs } from "./tag-elements.js";
export { localName, xmlTokens } from "./tags.js";
export { inWorker, serveReader, siblingModule } from "./worker.js";
export { ReaderBusy, WorkerDeadline } from "./worker-errors.js";
export { ReaderPool, WORKER_HEAP_MB } from "./worker-pool.js";
export { xmlText } from "./xml.js";
export {
  boundedZip,
  checkedArchive,
  readZip,
  zipParts,
} from "./zip-archive.js";
export { type CellFormats, cellFormats, NO_FORMATS } from "./zip-cell-formats.js";
export { cellValue } from "./zip-grid-cells.js";
export { MARKUP_BYTES_PER_CHAR, ZIP_LIMITS } from "./zip-limits.js";
export { cachedValueOf, cellRef, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./zip-sheet-cells.js";
export { MAX_SHEETS, sharedStrings, sheetTargets, WORKBOOK_PARTS } from "./zip-sheet-parts.js";
export { byNumber, RUNS, SLIDE_NUMBER } from "./zip-slide-order.js";
export { hiddenStyles, withoutHiddenRuns, wVal } from "./zip-word-hidden.js";
