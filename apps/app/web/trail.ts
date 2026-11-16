import { h } from "./dom.js";

/**
 * The trail: what the engine does for an answer, one quiet line per step as it happens. The step under way pulses;
 * a finished one settles; a failed one is named. While the model decides its next step the trail's last line says
 * only that it is working, never what it thinks. When the answer starts the trail folds to one line ("Searched once,
 * read 2 documents") that opens again on a click or Enter: the answer is the page, the working one tap away.
 */

type State = "running" | "done" | "failed" | "stopped";
type Kind = "search" | "read" | "limit" | "note" | "write" | "stop";
/** One line of the trail as it should read. */
export type Step = { kind: Kind; state: State; label: string };
type Shown = Step & { li: HTMLLIElement; since: number; later?: number; next?: Step };
type Trail = {
  steps: HTMLElement;
  working: HTMLElement;
  summary: HTMLButtonElement;
  root: HTMLElement;
  shown: Map<string, Shown>;
  over: boolean;
};

/** A step that finishes faster than this stays lit long enough to be seen, so the trail never flickers. */
const SEEN_MS = 600;

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const documents = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
const count = (t: Trail, kind: Kind) =>
  [...t.shown.values()].filter((s) => s.kind === kind && s.state === "done").length;

/** The folded line: how often it searched and read, and whether a step failed. */
function summed(t: Trail): string {
  const failed = [...t.shown.values()].some((s) => s.state === "failed");
  const parts = [
    count(t, "search") && `Searched ${times(count(t, "search"))}`,
    count(t, "read") && `read ${documents(count(t, "read"))}`,
    failed && "a step failed",
  ];
  return (
    parts
      .filter(Boolean)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase()) || "Worked"
  );
}

/** The summary, and the "Working" line, which shows only while nothing else is under way. */
function redraw(t: Trail): void {
  const busy = [...t.shown.values()].some((s) => s.state === "running");
  t.summary.textContent = summed(t);
  t.summary.classList.toggle("is-running", busy);
  t.working.hidden = t.over || busy;
  t.steps.append(t.working);
}

function set(t: Trail, key: string, step: Step): void {
  const known = t.shown.get(key);
  clearTimeout(known?.later);
  const held = !t.over && known?.state === "running" && step.state === "done";
  const early = held ? SEEN_MS - (Date.now() - known.since) : 0;
  if (known && early > 0) {
    known.later = window.setTimeout(() => set(t, key, step), early);
    known.next = step;
    return;
  }
  const li = known?.li ?? h("li");
  li.className = `step is-${step.state}`;
  li.textContent = step.label;
  t.shown.set(key, { ...step, li, since: known?.since ?? Date.now() });
  if (!known) t.steps.append(li);
  redraw(t);
}

function fold(t: Trail, folded: boolean): void {
  t.summary.hidden = false;
  t.root.classList.toggle("is-folded", folded);
  t.summary.setAttribute("aria-expanded", String(!folded));
}

/** The answer is over: every step still under way settles, and a closing step is said when there is one. */
function settle(t: Trail, closing?: { label: string; state: "done" | "failed" | "stopped" }): void {
  t.over = true;
  // Stopped, a step under way did not finish: it keeps its words and stops pulsing.
  const unfinished = closing?.state === "stopped" ? "stopped" : "done";
  for (const [key, s] of t.shown) {
    clearTimeout(s.later);
    // A step held lit a moment has already ended: it ends as it said, not as it began.
    const wrote = key === "write" && unfinished === "done";
    const label = wrote ? "Wrote the answer" : (s.li.textContent ?? "");
    if (s.next) set(t, key, s.next);
    else if (s.state === "running") set(t, key, { kind: s.kind, state: unfinished, label });
  }
  if (closing) set(t, "end", { kind: "stop", ...closing });
  if (closing) fold(t, false);
  redraw(t);
}

function made(): Trail {
  const steps = h("ol", { className: "trail-steps" });
  const working = h("li", { className: "step is-running is-pending" }, "Working");
  const summary = h("button", {
    className: "trail-summary",
    type: "button",
    hidden: true,
    attrs: { "aria-expanded": "true" },
  });
  const root = h(
    "div",
    { className: "trail" },
    summary,
    h("div", { className: "trail-body" }, steps),
  );
  steps.append(working);
  return { steps, working, summary, root, shown: new Map(), over: false };
}

export function trail() {
  const t = made();
  t.summary.addEventListener("click", () => fold(t, !t.root.classList.contains("is-folded")));
  return {
    root: t.root,
    step: (id: number, step: Step) => set(t, `step-${id}`, step),
    /** The answer has started: the last step is writing it, and the work folds away. */
    writing(): void {
      if (t.shown.has("write")) return;
      set(t, "write", { kind: "write", state: "running", label: "Writing the answer" });
      fold(t, true);
    },
    settle: (closing?: { label: string; state: "done" | "failed" | "stopped" }) =>
      settle(t, closing),
    lookups: () => count(t, "search") + count(t, "read"),
  };
}
