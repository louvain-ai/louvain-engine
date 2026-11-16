import { search } from "./api.js";
import { h, one } from "./dom.js";
import { command, field } from "./field.js";
import { spoken, unmatched } from "./hits.js";
import { paged } from "./pages.js";
import { SignedOut } from "./session.js";
import { onStatus } from "./status.js";
import type { Page, Status } from "./types.js";

/**
 * Search: type, and the documents arrive. The field never moves; results replace results without a jump (the old
 * ones dim while the new load); arrows walk the list and Enter opens the whole document beside it.
 */

const input = one<HTMLInputElement>(".query-input");
const results = one(".results");
/** What a screen reader hears when results land: how many, never the list itself. */
const said = one(".search-said");
const WAIT_MS = 160;
/** Past this, a search still running says so: a first search after a start warms the engine's models. */
const SLOW_MS = 1500;
let loaded: Status | null = null;
let running: AbortController | undefined;
let timer: number | undefined;

/** A search the engine would not run, in its own sentence. */
const refused = (q: string, why: string) =>
  h(
    "div",
    { className: "quiet-state" },
    h("p", { className: "eyebrow" }, `You searched “${q}”`),
    h("p", { className: "quiet-title" }, why),
  );

const nothing = (q: string) =>
  loaded?.documents === 0
    ? empty()
    : h(
        "div",
        { className: "quiet-state" },
        h("p", { className: "eyebrow" }, `You searched “${q}”`),
        h("p", { className: "quiet-title" }, "Nothing in your documents matches this search."),
        h("p", {}, "Try fewer words, or other ones."),
      );

function show(q: string, page: Page): void {
  said.textContent = page.refusal ?? spoken(page);
  if (page.refusal) results.replaceChildren(refused(q, page.refusal));
  else if (page.sources.length > 0) paged(results, q, (cursor) => find(q, cursor))(page);
  // Nothing matched: the engine's own sentence stands alone, with nothing listed and nothing to page.
  else if (page.note) results.replaceChildren(unmatched(q, page));
  else results.replaceChildren(nothing(q));
}

/** Nothing loaded: the one thing to do. */
const empty = () =>
  field({
    eyebrow: "Nothing loaded",
    title: "Load a folder to begin.",
    lines: [
      "Every readable file in it becomes a document you can search and ask about.",
      command("./engine ingest folder --folder <path>"),
    ],
  });

function idle(): void {
  results.replaceChildren(
    loaded?.documents === 0
      ? empty()
      : field({
          eyebrow: loaded ? `${loaded.documents} documents` : "Search",
          title: "Find it in your documents.",
          lines: ["Search by meaning and by words together. Press / from anywhere to begin."],
        }),
  );
}

function failed(q: string): void {
  const retry = h("button", { className: "quiet-button", type: "button" }, "Try again");
  retry.addEventListener("click", () => void run(q));
  results.replaceChildren(
    h(
      "div",
      { className: "quiet-state is-error" },
      h("p", { className: "quiet-title" }, "The engine did not answer."),
      h("p", {}, "It may be busy or stopped. ", command("./engine status")),
      retry,
    ),
  );
}

/** One page, or null when it failed or a newer search superseded it. */
async function find(q: string, cursor: string | null): Promise<Page | null> {
  running?.abort();
  const mine = new AbortController();
  running = mine;
  try {
    return await search(q, cursor, mine.signal);
  } catch (err) {
    if (!(err instanceof SignedOut) && !mine.signal.aborted) failed(q);
    return null;
  }
}

const slowNote = () =>
  h(
    "p",
    { className: "slow-note mono", attrs: { role: "status" } },
    "Still searching. The first search after a start takes longest.",
  );

async function run(q: string): Promise<void> {
  if (!q) return idle();
  const showing = results.querySelector(".hits");
  if (showing) results.classList.add("is-stale");
  else
    results.replaceChildren(
      h(
        "ol",
        { className: "hits" },
        ...[0, 1, 2].map(() => h("li", { className: "skeleton skeleton-hit" })),
      ),
    );
  results.ariaBusy = "true";
  results.querySelector(".slow-note")?.remove();
  const slow = window.setTimeout(() => results.prepend(slowNote()), SLOW_MS);
  const page = await find(q, null);
  clearTimeout(slow);
  results.querySelector(".slow-note")?.remove();
  results.classList.remove("is-stale");
  results.ariaBusy = "false";
  if (page) show(q, page);
}

function walk(e: KeyboardEvent): void {
  const hits = [...results.querySelectorAll<HTMLButtonElement>(".hit")];
  const at = hits.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown") hits[Math.min(at + 1, hits.length - 1)]?.focus();
  else if (e.key === "ArrowUp") (at <= 0 ? input : hits[at - 1])?.focus();
  else return;
  e.preventDefault();
}

input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(input.value.trim()), WAIT_MS);
});
input.form?.addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(timer);
  void run(input.value.trim());
});
input.addEventListener("keydown", walk);
results.addEventListener("keydown", walk);
onStatus((s) => {
  loaded = s;
  if (!input.value.trim()) idle();
});

export const focusSearch = () => input.focus();
