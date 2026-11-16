import type { Range } from "./terms.js";

/**
 * The whole view layer: make an element, find one, mark words in text. Text goes in as text nodes, never as markup,
 * so a document's words cannot become part of the page.
 */

type Child = Node | string | false | null | undefined;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "style">
> & {
  attrs?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const { attrs, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  for (const [name, value] of Object.entries(attrs ?? {})) el.setAttribute(name, value);
  el.append(...children.filter((c): c is Node | string => c !== false && c != null));
  return el;
}

/** The one element a selector names, which the page always has. */
export function one<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`the page has no ${selector}`);
  return el;
}

/** How to scroll: smoothly, unless the person asked for less motion. */
export const scrolling = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/** Text with the ranges given wrapped in `<mark>`, as nodes: the text itself is never parsed. */
export function marked(text: string, ranges: readonly Range[], className: string): Node[] {
  const nodes: Node[] = [];
  let at = 0;
  for (const r of ranges) {
    const start = Math.max(r.start, at);
    const end = Math.min(r.end, text.length);
    if (end <= start) continue;
    nodes.push(document.createTextNode(text.slice(at, start)));
    const mark = document.createElement("mark");
    mark.className = className;
    mark.textContent = text.slice(start, end);
    nodes.push(mark);
    at = end;
  }
  nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}
