import { documentById } from "./api.js";
import { h, marked, one, scrolling } from "./dom.js";
import type { Range } from "./terms.js";
import { formatDay, locate, paragraphs, unwrap } from "./text.js";

/**
 * The reader: a whole document beside the list, the passage that brought you here marked in place and scrolled to.
 * A panel on a wide screen, a sheet over everything on a phone; Esc or the close button puts you back where you were.
 */

const panel = one("aside.reader");
const page = one("article.reader-page");
const meta = one(".reader-meta");
let returnTo: HTMLElement | null = null;
let opened = 0;

/**
 * The document as paragraphs. A paragraph wholly inside the passage carries a rule in the margin; a passage that starts
 * or ends inside one is marked word for word there. So a long passage reads as a quiet bar, not a page of highlighter.
 */
function body(text: string, cited: Range | null): HTMLElement[] {
  const flowing = unwrap(text);
  return paragraphs(flowing).map(({ start, end }) => {
    const words = flowing.slice(start, end);
    if (cited && cited.start <= start && end <= cited.end)
      return h("p", { className: "in-passage" }, words);
    const here = cited ? [{ start: cited.start - start, end: cited.end - start }] : [];
    return h("p", {}, ...marked(words, here, "cite"));
  });
}

function skeleton(): HTMLElement[] {
  return [
    h("div", { className: "skeleton skeleton-title" }),
    ...[1, 2, 3, 4, 5].map(() => h("div", { className: "skeleton skeleton-line" })),
  ];
}

export function closeReader(): void {
  if (panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove("reading");
  returnTo?.focus();
}

/** Opens a document, marking `passage` where it sits. The newest open wins when two race. */
export async function openReader(
  id: string,
  passage: string,
  from: HTMLElement | null,
): Promise<void> {
  const mine = ++opened;
  returnTo = from;
  panel.hidden = false;
  document.body.classList.add("reading");
  meta.textContent = "Document";
  page.replaceChildren(...skeleton());
  try {
    const doc = await documentById(id);
    if (mine !== opened) return;
    meta.textContent = `${formatDay(doc.date)}${doc.cut ? " · shown in part" : ""}`;
    page.replaceChildren(
      h("h2", { className: "reader-title display" }, doc.title),
      ...body(doc.text, locate(doc.text, passage)),
    );
    const cite = page.querySelector("mark.cite, .in-passage");
    page.focus({ preventScroll: true });
    cite?.scrollIntoView({
      block: "center",
      behavior: scrolling(),
    });
  } catch {
    // swallowed: a sign-out is answered by the sign-in screen; anything else is said here, in the panel.
    if (mine === opened)
      page.replaceChildren(
        h(
          "p",
          { className: "reader-error" },
          "This document could not be opened. Try again in a moment.",
        ),
      );
  }
}

one(".reader-close").addEventListener("click", closeReader);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden) closeReader();
});
