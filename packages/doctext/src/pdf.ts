/**
 * PDF text, through pdf.js: the extractor that has met the most real PDFs, pure JavaScript (no native memory to
 * corrupt) and no canvas (text extraction never rasterises a page). A scanned PDF has no text layer, and that is
 * reported (`noTextLayer`) rather than returned as empty: "images of a document" is a different fact from "empty".
 */
import { withDeadline } from "@louvain/engine-core";
import { type DocLocator, LocatorTrail } from "./locator.js";
import { tidy } from "./plain.js";

/** What the caller gets back, beside the text. */
export type PdfMeta = {
  pages: number;
  pagesRead: number;
  pagesWithoutText: number;
  noTextLayer?: boolean;
  truncated?: boolean;
  /** The deadline passed with pages left; the pages read before it are the text. */
  timedOut?: boolean;
};

/** The document could not even be opened within the deadline, so there is nothing to keep. */
export class PdfDeadline extends Error {}

type PdfOptions = {
  maxPages?: number | undefined;
  /** Stop reading pages once this much text is held — the caller's cap would discard the rest. */
  maxChars?: number | undefined;
  deadlineMs?: number | undefined;
};

/**
 * A page is one `getTextContent()` call returning positioned items, joined with pdf.js's own line ends (`hasEOL`):
 * joined blindly, a two-column layout interleaves its columns and a table of figures becomes one long number.
 */
export async function pdfText(
  data: Uint8Array,
  options: PdfOptions = {},
): Promise<{ text: string; meta: PdfMeta; locators: DocLocator[] }> {
  // The legacy build runs on Node without a DOM; imported lazily, so a process that never meets a PDF never loads it.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const maxPages = options.maxPages ?? 1000;
  const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
  const deadline = Date.now() + (options.deadlineMs ?? 30_000);
  const task = openPdf(pdfjs, data);
  try {
    const document = await before(
      task.promise,
      deadline,
      "The PDF could not be opened within the time allowed for one file",
    );
    const total = document.numPages;
    const pages = await readPages(document, {
      read: Math.min(total, maxPages),
      maxChars,
      deadline,
    });
    const { pagesRead, empty, timedOut, full } = pages;
    const meta: PdfMeta = {
      pages: total,
      pagesRead,
      pagesWithoutText: empty,
      ...(total > pagesRead ? { truncated: true } : {}),
      ...(timedOut ? { timedOut: true } : {}),
      ...(!timedOut && !full && pagesRead > 0 && empty === pagesRead ? { noTextLayer: true } : {}),
    };
    return { text: pages.trail.text(), meta, locators: pages.trail.locators() };
  } finally {
    // Releases pdf.js's worker and page cache and stops a document that lost the race; a cleanup failure never masks the text.
    await task.destroy().catch(() => {});
  }
}

/** The loading task for a copy of `data`, with nothing rendered. */
function openPdf(pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"), data: Uint8Array) {
  return pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given; a copy keeps the caller's bytes usable (they are hashed too).
    data: new Uint8Array(data),
    useSystemFonts: false,
    // Nothing is rendered, so no font or map data is needed; naming them silences the warning without the assets.
    disableFontFace: true,
    // No `isEvalSupported` switch: pdf.js has no `new Function` font path, and a test greps the shipped build for it so an upgrade that adds one fails.
    verbosity: 0,
  });
}

type PdfDocument = {
  getPage(number: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
};

/**
 * Pages in order until the deadline, the character cap or the last page. Each page is tidied before its offsets are
 * taken, so the trail's text is the final text and no locator moves.
 */
async function readPages(
  document: PdfDocument,
  limits: { read: number; maxChars: number; deadline: number },
): Promise<{
  trail: LocatorTrail;
  empty: number;
  pagesRead: number;
  timedOut: boolean;
  full: boolean;
}> {
  const trail = new LocatorTrail();
  const out = { trail, empty: 0, pagesRead: 0, timedOut: false, full: false };
  for (let number = 1; number <= limits.read; number++) {
    if (Date.now() >= limits.deadline) {
      out.timedOut = true;
      break;
    }
    if (trail.text().length >= limits.maxChars) {
      out.full = true;
      break;
    }
    out.pagesRead = number;
    const page = await pageText(document, number, limits.deadline);
    if (page === null) {
      // The page running when time ran out is not counted as read.
      out.pagesRead = number - 1;
      out.timedOut = true;
      break;
    }
    const cleaned = tidy(page);
    if (cleaned) {
      if (trail.text()) trail.gap("\n\n");
      trail.push(cleaned, { page: number });
    } else out.empty++;
  }
  return out;
}

/** One page's text, "" for a damaged page (one is common, and must not cost the rest), null when time ran out. */
async function pageText(
  document: PdfDocument,
  number: number,
  deadline: number,
): Promise<string | null> {
  try {
    const content = await before(
      document.getPage(number).then((p) => p.getTextContent()),
      deadline,
      "page",
    );
    return content.items
      .map((item) => (isTextItem(item) ? item.str + (item.hasEOL ? "\n" : "") : ""))
      .join("");
  } catch (error) {
    if (error instanceof PdfDeadline) return null;
    return "";
  }
}

const isTextItem = (item: unknown): item is { str: string; hasEOL: boolean } =>
  typeof item === "object" && item !== null && "str" in item;

/**
 * A promise that loses to the clock; `task.destroy()` in the caller stops the work. A timer cannot interrupt a
 * synchronous parse step that never yields: the page loop yields between pages and pdf.js inside a page's stream,
 * where the time goes, and the page and character caps bound how many such steps there are.
 */
async function before<T>(work: Promise<T>, deadline: number, what: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PdfDeadline(what);
  return await withDeadline(() => work, remaining, {
    onTimeout: () => {
      throw new PdfDeadline(what);
    },
  });
}
