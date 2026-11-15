import { h, marked } from "./dom.js";
import { lex } from "./lexer.js";
import { openReader } from "./reader.js";
import { reasons, headline as topNumber } from "./scores.js";
import { plainText } from "./snippet.js";
import { type Terms, termRanges } from "./terms.js";
import { shortDay } from "./text.js";
import type { Hit, Match, Page } from "./types.js";

/**
 * What a search found, drawn as the engine says it: its matches, each saying how it matched (by its words, or else by
 * meaning) and the numbers the engine sent (`scores.ts`). When nothing matched, the page is the engine's sentence alone;
 * what the engine lists as only loosely related is for agents that want it, and is not shown.
 */

/** How a match matched: one word for the row, and the sentence the detail and the accessible name say. */
function how(match: Match): { word: string; said: string } {
  if (match.exact) return { word: "Exact", said: "Exact match." };
  if (typeof match.relevance === "number")
    return { word: "Relevance", said: "Scored by the reranker." };
  if (match.words) return { word: "Words", said: "Matched by its words." };
  if (match.meaning !== null) return { word: "Meaning", said: "Matched by meaning." };
  return { word: "Match", said: "The engine did not say how it matched." };
}

/** The row's quiet facts: a short date, and one word with its figure, which opens why the result is here. */
function facts(hit: Hit, place: number): HTMLElement[] {
  const by = how(hit.match);
  const top = topNumber(hit.match);
  const lines = [by.said, ...reasons(hit.match, place)];
  const why = h("ul", { className: "hit-why", hidden: true }, ...lines.map((l) => h("li", {}, l)));
  const open = h(
    "button",
    { className: "hit-how", type: "button", title: lines.join(" ") },
    by.word,
    top ? h("span", { className: "hit-figure" }, top.figure) : null,
  );
  open.ariaLabel = `Why this result: ${lines.join(" ")}`;
  open.setAttribute("aria-expanded", "false");
  open.addEventListener("click", () => {
    why.hidden = !why.hidden;
    open.setAttribute("aria-expanded", String(!why.hidden));
  });
  return [h("div", { className: "hit-meta mono" }, h("span", {}, shortDay(hit.date)), open), why];
}

/** One matched document of a page, at `place` (from 1). */
export function hitRow(hit: Hit, terms: Terms, place: number): HTMLElement {
  // A passage may be markdown: under a result it is its words alone, and the query lights those.
  const words = plainText(lex(hit.passage));
  const open = h(
    "button",
    { className: hit.match.exact ? "hit is-exact" : "hit", type: "button" },
    h(
      "span",
      { className: "hit-title" },
      ...marked(hit.title, termRanges(hit.title, terms), "word"),
    ),
    h("span", { className: "hit-passage" }, ...marked(words, termRanges(words, terms), "word")),
  );
  open.addEventListener("click", () => openReader(hit.id, hit.passage, open));
  return h("li", { className: "hit-row" }, open, ...facts(hit, place));
}

/** The engine's sentence for a page with no match, without the name of the field its other documents are in. */
function headline(note: string): string[] {
  const said = note
    .replace(/\s+are listed under looselyRelated;\s*they\s+/, " ")
    .replace(/\blooselyRelated\b/g, "loosely related");
  const [first, ...rest] = said.split(/(?<=\.)\s+/);
  return [first ?? said, rest.join(" ")];
}

/** A page where nothing matched: what was searched (as typed), and the engine's sentence alone. */
export function unmatched(query: string, page: Page): HTMLElement {
  const [title, line] = headline(page.note ?? "Nothing in your documents matches this search.");
  return h(
    "div",
    { className: "quiet-state" },
    h("p", { className: "eyebrow" }, `You searched “${query}”`),
    h("p", { className: "quiet-title" }, title ?? ""),
    line ? h("p", {}, line) : null,
  );
}

/** What a screen reader hears when a page lands: how many matched, never the list itself. */
export function spoken(page: Page): string {
  if (page.sources.length === 0) return "Nothing matches.";
  return `${page.sources.length}${page.next ? " or more" : ""} documents match.`;
}
