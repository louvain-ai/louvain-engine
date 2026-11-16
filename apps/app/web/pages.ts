import { h } from "./dom.js";
import { hitRow } from "./hits.js";
import { queryTerms, type Terms } from "./terms.js";
import type { Page } from "./types.js";

/**
 * A search's matches, page by page: one list that grows, never swaps. "More results" stands under it only while more
 * matches may remain: the engine sends its loosely related documents after the last match, so a page carrying any
 * means the matches have ended, and nothing more is asked for. Those documents are never drawn.
 */

type View = {
  terms: Terms;
  list: HTMLElement;
  find: (cursor: string) => Promise<Page | null>;
};

/** Whether a further page may hold a match: a cursor, and no sign that the matches have ended. */
const moreMatches = (page: Page): string | null =>
  page.looselyRelated.length === 0 ? page.next : null;

function add(v: View, page: Page): void {
  const at = v.list.childElementCount;
  v.list.append(...page.sources.map((hit, i) => hitRow(hit, v.terms, at + i + 1)));
}

function control(v: View, next: string | null): void {
  if (!next) return;
  const button = h("button", { className: "more quiet-button", type: "button" }, "More results");
  button.addEventListener("click", async () => {
    button.disabled = true;
    const page = await v.find(next);
    button.disabled = false;
    if (!page) return;
    button.remove();
    add(v, page);
    if (page.sources.length === 0)
      v.list.after(h("p", { className: "slow-note mono" }, "No more matches."));
    control(v, moreMatches(page));
  });
  v.list.after(button);
}

/** Draws a search's first page of matches into `root`, and pages on as asked. */
export function paged(root: HTMLElement, q: string, find: View["find"]) {
  return (page: Page): void => {
    const list = h("ol", { className: "hits" });
    // A note on a page that matched is the engine's own word on what it searched (a nearer spelling, say).
    const note = page.note ? [h("p", { className: "search-note" }, page.note)] : [];
    root.replaceChildren(...note, list);
    const v: View = { terms: queryTerms(q), list, find };
    add(v, page);
    control(v, moreMatches(page));
  };
}
