import type { Source } from "./ask-stream.js";
import { h } from "./dom.js";
import { markdownView } from "./markdown.js";
import { openReader } from "./reader.js";

/**
 * An answer on the page: its markdown drawn as it is written (`markdown.ts`), each citation a small numbered button
 * that opens the reader at the passage that source was found by, and lights its card while pointed at. A ref no
 * source has stays as written.
 */

/** The card a chip points at, lit while the chip is pointed at or focused. */
function lights(button: HTMLButtonElement, ref: string): void {
  const card = () => button.closest(".exchange")?.querySelector(`.source[data-ref="${ref}"]`);
  for (const on of ["mouseenter", "focus"])
    button.addEventListener(on, () => card()?.classList.add("is-pointed"));
  for (const off of ["mouseleave", "blur"])
    button.addEventListener(off, () => card()?.classList.remove("is-pointed"));
}

function chip(source: Source): HTMLButtonElement {
  const button = h(
    "button",
    {
      className: "cite-chip",
      type: "button",
      title: source.title,
      attrs: { "aria-label": `Source ${source.n}, ${source.title}` },
    },
    String(source.n),
  );
  button.addEventListener("click", () => openReader(source.id, source.passage, button));
  lights(button, source.ref);
  return button;
}

/** A link the answer made to a source it was shown: its words, opening that source. */
function sourceLink(source: Source, kids: Node[]): HTMLButtonElement {
  const button = h("button", { className: "source-link", type: "button" }, ...kids);
  button.addEventListener("click", () => openReader(source.id, source.passage, button));
  lights(button, source.ref);
  return button;
}

/** Draws an answer into `root` as it streams; sources are looked up as each citation is drawn. */
export function answerView(root: HTMLElement, sources: ReadonlyMap<string, Source>) {
  const draw = markdownView(root, {
    known: (ref) => sources.has(ref),
    chip: (ref) => chip(sources.get(ref) as Source),
    source: (ref, kids) => sourceLink(sources.get(ref) as Source, kids),
  });
  return (text: string, writing: boolean) => draw(text, writing, sources.size);
}

/** The documents read for an answer, a card each the moment it is read; a citation lights its card. */
export function sourceCards() {
  const list = h("ol", { className: "sources", attrs: { "aria-label": "Sources" } });
  const eyebrow = h("p", { className: "eyebrow" }, "Sources");
  const root = h("section", { className: "sources-block", hidden: true }, eyebrow, list);
  const card = (ref: string) => list.querySelector(`.source[data-ref="${ref}"]`);
  return {
    root,
    add(source: Source): void {
      if (card(source.ref)) return;
      const open = h(
        "button",
        { className: "source", type: "button", attrs: { "data-ref": source.ref } },
        h("span", { className: "source-n mono" }, String(source.n)),
        h("span", { className: "source-title" }, source.title),
        h("span", { className: "source-passage" }, source.passage),
      );
      open.addEventListener("click", () => openReader(source.id, source.passage, open));
      list.append(h("li", {}, open));
      root.hidden = false;
    },
    cite: (ref: string) => card(ref)?.classList.add("is-cited"),
    /** Once the answer is whole, the documents it never cited step back. */
    finish: () => root.classList.add("is-final"),
    /** With no answer, what was read is named as read, never as support. */
    unused: () => {
      eyebrow.textContent = "Read, and none of it says";
      list.ariaLabel = "Read, and none of it says";
    },
  };
}
