/**
 * Where in the document a run of the extracted text came from: a page, a sheet or a slide. The mapping can only be
 * built while the file is read, so it is captured then. The grain is the page, not the text run: a document view
 * holding the page and the sentence finds the sentence in its text layer, and per-run boxes would cost a row read on
 * every citation. A format with no pagination gets none: one flow, so the offset is the locator.
 */
export type DocLocator = {
  /** Inclusive character offset into the extracted text. */
  start: number;
  /** Exclusive. */
  end: number;
  /** 1-based, for a paginated document. */
  page?: number;
  /** A workbook's tab — the name, because a person reads the name. */
  sheet?: string;
  /** 1-based, for a deck. */
  slide?: number;
};

/**
 * Collects locators while the text is assembled, so a reader never has to
 * count characters itself — the commonest way to produce an off-by-one that
 * puts a highlight on the wrong line.
 */
export class LocatorTrail {
  private readonly parts: string[] = [];
  private readonly located: DocLocator[] = [];
  private at = 0;

  /** Append a piece of text that belongs to one place in the document. */
  push(text: string, where: Omit<DocLocator, "start" | "end">): void {
    if (text.length === 0) return;
    this.parts.push(text);
    this.located.push({ start: this.at, end: this.at + text.length, ...where });
    this.at += text.length;
  }

  /** Append text that belongs nowhere in particular — a joiner, a blank line. */
  gap(text: string): void {
    if (text.length === 0) return;
    this.parts.push(text);
    this.at += text.length;
  }

  text(): string {
    return this.parts.join("");
  }

  locators(): DocLocator[] {
    return this.located;
  }
}

/**
 * Move every locator by `offset`, and drop what a cut has removed: tidying, the character cap and an envelope a
 * caller prepends each move the text, and a locator that ignored one would misplace every highlight.
 */
export function shiftLocators(
  locators: DocLocator[],
  offset: number,
  limit?: number,
): DocLocator[] {
  const out: DocLocator[] = [];
  for (const locator of locators) {
    const start = locator.start + offset;
    const end = limit === undefined ? locator.end + offset : Math.min(locator.end + offset, limit);
    // A range the cut removed entirely is not a range.
    if (limit !== undefined && start >= limit) continue;
    out.push({ ...locator, start, end });
  }
  return out;
}
