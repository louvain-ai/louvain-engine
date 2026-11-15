import { type DocLocator, LocatorTrail } from "./locator.js";
import { htmlToText, text, tidy } from "./plain.js";
import { xmlText } from "./xml.js";
import { readZip } from "./zip-archive.js";
import { byNumber, RUNS, SLIDE_NUMBER } from "./zip-slide-order.js";

/**
 * Slides in their own order, with the speaker notes.
 *
 * The notes are the reason this is not just the slide text: a deck's slide is
 * three words and a chart, and the sentence that says what the number means is
 * in the notes pane. A deck read without them is a list of headings.
 */
export function pptxText(
  data: Uint8Array,
  maxChars = Number.POSITIVE_INFINITY,
): {
  text: string;
  meta: Record<string, unknown>;
  locators: DocLocator[];
} {
  const read = readZip(
    data,
    (name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
    maxChars,
  );
  const files = read.files;
  let truncated = read.truncated;
  const slides = [...files.keys()].filter((n) => n.startsWith("ppt/slides/")).sort(byNumber);
  // One locator per slide, for the same reason a workbook gets one per sheet.
  const trail = new LocatorTrail();
  for (const name of slides) {
    if (trail.text().length >= maxChars) {
      truncated = true;
      break;
    }
    const number = SLIDE_NUMBER.exec(name)?.[1] ?? "";
    const cleaned = tidy(slideLines(files, name, number).join("\n"));
    if (cleaned) {
      if (trail.text()) trail.gap("\n");
      const slide = Number(number);
      trail.push(cleaned, Number.isFinite(slide) && slide > 0 ? { slide } : {});
    }
  }
  return {
    text: trail.text(),
    meta: { slides: slides.length, ...(truncated ? { truncated } : {}) },
    locators: trail.locators(),
  };
}

/** A slide's heading, its typed text and its speaker notes' own prose. */
function slideLines(files: Map<string, Uint8Array>, name: string, number: string): string[] {
  const out: string[] = [`## Slide ${number}`];
  out.push(
    xmlText(text(files.get(name)), {
      only: RUNS,
      breakAfter: new Set(["p", "br"]),
      tabAfter: new Set(["tc"]),
    }),
  );
  const notes = files.get(`ppt/notesSlides/notesSlide${number}.xml`);
  if (notes) {
    const rendered = xmlText(text(notes), {
      only: RUNS,
      breakAfter: new Set(["p", "br"]),
    }).trim();
    // The slide's own text is repeated inside its notes part by the format; only the notes' own prose is added.
    if (rendered) out.push(`Notes: ${rendered}`);
  }
  return out;
}

// ————— OpenDocument —————

export function odfText(
  data: Uint8Array,
  maxChars = Number.POSITIVE_INFINITY,
): { text: string; meta: Record<string, unknown> } {
  const { files, truncated } = readZip(
    data,
    (name) => name === "content.xml" || name === "mimetype",
    maxChars,
  );
  const content = files.get("content.xml");
  if (!content) throw new Error("not an OpenDocument file: content.xml is missing");
  const kind = text(files.get("mimetype")).trim();
  return {
    text: xmlText(text(content), {
      skip: new Set(["tracked-changes", "annotation", "binary-data"]),
      breakAfter: new Set(["p", "h", "list-item", "table-row"]),
      tabAfter: new Set(["table-cell", "tab"]),
    }),
    meta: { ...(kind ? { mimeType: kind } : {}), ...(truncated ? { truncated } : {}) },
  };
}

// ————— EPUB —————

export function epubText(
  data: Uint8Array,
  maxChars = Number.POSITIVE_INFINITY,
): { text: string; meta: Record<string, unknown> } {
  const read = readZip(data, (name) => /\.(x?html|htm)$/i.test(name), maxChars);
  let truncated = read.truncated;
  // Sorted by name: the spine in the OPF is the true reading order, and
  // getting it needs the container/OPF chain for a gain — chapter order — that
  // does not change what any sentence says.
  const names = [...read.files.keys()].sort();
  const parts: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length >= maxChars) {
      truncated = true;
      break;
    }
    const chapter = htmlToText(text(read.files.get(name))).trim();
    if (!chapter) continue;
    parts.push(chapter);
    length += chapter.length;
  }
  return {
    text: parts.join("\n\n"),
    meta: { documents: names.length, ...(truncated ? { truncated } : {}) },
  };
}
