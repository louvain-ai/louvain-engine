/**
 * A `.docx` as text. A paragraph inside a table ends with a space and the cell and row supply the tab and the
 * newline, so a row's values stay one line instead of scattering across passages. Field codes and tracked deletions
 * are skipped: a struck-out figure is the document's history, not its content. Footnotes and endnotes follow.
 */
import { text } from "./plain.js";
import { xmlText } from "./xml.js";
import { readZip } from "./zip-archive.js";
import { hiddenStyles, withoutHiddenRuns } from "./zip-word-hidden.js";

export function docxText(
  data: Uint8Array,
  maxChars = Number.POSITIVE_INFINITY,
  /** `visibleOnly` leaves out the runs the author hid, for a view that shows the document as its author shows it. */
  options: { visibleOnly?: boolean } = {},
): { text: string; meta: Record<string, unknown> } {
  const { files, truncated } = readZip(
    data,
    (name) =>
      name === "word/document.xml" ||
      name === "word/footnotes.xml" ||
      name === "word/endnotes.xml" ||
      (options.visibleOnly === true && name === "word/styles.xml") ||
      /^word\/header\d*\.xml$/.test(name),
    maxChars,
  );
  const body = files.get("word/document.xml");
  if (!body) throw new Error("not a Word document: word/document.xml is missing");
  const word = wordRenderer();
  const styles = files.get("word/styles.xml");
  const hidden = options.visibleOnly ? hiddenStyles(styles ? text(styles) : undefined) : null;
  const shown = (xml: string): string => (hidden ? withoutHiddenRuns(xml, hidden) : xml);
  const parts = [word.render(shown(text(body)))];
  // Footnotes often carry a contract's real term, and they are separate parts of the archive.
  for (const name of ["word/footnotes.xml", "word/endnotes.xml"]) {
    const note = files.get(name);
    if (note) {
      const rendered = word.render(shown(text(note))).trim();
      if (rendered) parts.push(rendered);
    }
  }
  return {
    text: parts.join("\n\n"),
    meta: { tables: word.tables(), ...(truncated ? { truncated } : {}) },
  };
}

/** Word XML to text, counting the tables it opens; table depth is the one piece of state the scan keeps. */
function wordRenderer(): { render: (xml: string) => string; tables: () => number } {
  let tables = 0;
  let depth = 0;
  const render = (xml: string): string =>
    xmlText(xml, {
      skip: new Set(["instrtext", "del", "prooferr", "bookmarkstart"]),
      tabAfter: new Set(["tab"]),
      breakAfter: new Set(["br", "cr"]),
      onElement: (name, open) => {
        if (name !== "tbl") return;
        if (open) {
          depth++;
          tables++;
        } else depth = Math.max(0, depth - 1);
      },
      endsWith: (name) => {
        if (name === "p") return depth > 0 ? " " : "\n";
        if (name === "tc") return "\t";
        if (name === "tr") return "\n";
        return null;
      },
    });
  return { render, tables: () => tables };
}
