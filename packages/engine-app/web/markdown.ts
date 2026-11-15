import { citations, withoutOpenCitation } from "./cite.js";
import { h } from "./dom.js";
import { lex } from "./lexer.js";
import { blocks, type Tree } from "./md-tree.js";
import type { Token } from "./md-types.js";

/**
 * An answer drawn as it is written. Each block the answer has finished is markdown (`md-tree.ts` says what it may
 * become); the block still being written is plain text with its chips (a list, its finished items as items), so
 * nothing changes shape under the reader's eye while it is open. A finished block is drawn once and kept.
 */

/** How the page draws what only it can: a chip for a ref, a link that opens a source. */
export type Parts = {
  known: (ref: string) => boolean;
  chip: (ref: string) => HTMLElement;
  source: (ref: string, kids: Node[]) => HTMLElement;
};

function build(tree: Tree, parts: Parts): Node {
  if (typeof tree === "string") return document.createTextNode(tree);
  if ("cite" in tree)
    return h("span", { className: "cited" }, tree.glue, ...tree.cite.map(parts.chip));
  if ("open" in tree)
    return parts.source(
      tree.open,
      tree.kids.map((k) => build(k, parts)),
    );
  const node = document.createElement(tree.tag);
  if (tree.align) node.className = `align-${tree.align}`;
  if (tree.start !== undefined && node instanceof HTMLOListElement) node.start = tree.start;
  node.append(...tree.kids.map((k) => build(k, parts)));
  return node;
}

/** Words still being written: as they are, a citation shown only once it is closed. */
function plain(raw: string, parts: Parts): Node[] {
  const pieces = citations(withoutOpenCitation(raw.trim()), parts.known);
  return pieces.map((p) =>
    build(typeof p === "string" ? p : { cite: p.refs, glue: p.glue }, parts),
  );
}

/** A list being written: its finished items drawn as items, the one being written as plain text. */
function openList(t: Token, parts: Parts): HTMLElement {
  const items = t.items ?? [];
  const list = document.createElement(t.ordered ? "ol" : "ul");
  if (t.ordered && typeof t.start === "number" && t.start !== 1)
    Object.assign(list, { start: t.start });
  for (const item of items.slice(0, -1))
    list.append(build({ tag: "li", kids: blocks(item.tokens ?? [], parts.known) }, parts));
  list.append(h("li", { className: "is-open" }, ...plain(items.at(-1)?.text ?? "", parts)));
  return list;
}

/** The block being written: plain text, or a list whose finished items are already items. */
const openBlock = (t: Token, parts: Parts): HTMLElement =>
  t.type === "list" && t.items?.length
    ? openList(t, parts)
    : h("p", { className: "is-open" }, ...plain(t.raw ?? "", parts));

type Drawn = { key: string; nodes: Node[] };

/** Draws `text` into `root`; `writing` while more may come. `version` changes when a new source can be cited. */
export function markdownView(root: HTMLElement, parts: Parts) {
  let drawn: Drawn[] = [];
  let open: Node | null = null;
  return (text: string, writing: boolean, version: number): void => {
    const tokens = lex(text).filter((t) => t.type !== "space");
    const last = writing ? tokens.pop() : undefined;
    let same = 0;
    while (same < tokens.length && drawn[same]?.key === `${version}:${tokens[same]?.raw}`) same++;
    for (const gone of drawn.slice(same))
      for (const node of gone.nodes) node.parentNode?.removeChild(node);
    open?.parentNode?.removeChild(open);
    drawn = drawn.slice(0, same);
    for (const t of tokens.slice(same)) {
      const nodes = blocks([t], parts.known).map((b) => build(b, parts));
      root.append(...nodes);
      drawn.push({ key: `${version}:${t.raw}`, nodes });
    }
    open = last?.raw ? openBlock(last, parts) : null;
    if (open) root.append(open);
  };
}
