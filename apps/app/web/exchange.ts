import { answerView, sourceCards } from "./answer.js";
import type { AskEvent, Source } from "./ask-stream.js";
import { h } from "./dom.js";
import { trail } from "./trail.js";

/**
 * One exchange on the page: the question, the trail of what the engine did, the answer as it is written, the sources
 * it read, and how it ended. Each event the server sends changes it in one place.
 */

type Closing = { label: string; state: "done" | "failed" | "stopped" };

/** Why an answer could not be finished, as the trail names it. */
const FAILED = {
  key: "The model refused the key: check ANTHROPIC_API_KEY in .env",
  busy: "The model is busy: try again in a minute",
  other: "The answer could not be finished",
};

function made(question: string) {
  const work = trail();
  const answer = h("div", { className: "answer" });
  const cards = sourceCards();
  const ending = h("p", { className: "ending", hidden: true });
  const item = h(
    "li",
    { className: "exchange is-working" },
    h("h2", { className: "question display" }, question),
    work.root,
    answer,
    cards.root,
    ending,
  );
  const sources = new Map<string, Source>();
  return {
    work,
    answer,
    cards,
    ending,
    item,
    sources,
    draw: answerView(answer, sources),
    text: "",
  };
}

type Exchange = ReturnType<typeof made>;

const say = (x: Exchange, line: string) =>
  Object.assign(x.ending, { textContent: line, hidden: false });

function end(x: Exchange, closing?: Closing): void {
  if (!x.item.classList.contains("is-working")) return;
  x.item.classList.remove("is-working");
  x.answer.classList.remove("is-writing");
  if (x.text) x.draw(x.text, false);
  x.work.settle(closing);
  x.cards.finish();
}

function unanswered(x: Exchange, why: "sources-silent" | "refused" | "limit") {
  const lookups = x.work.lookups();
  if (why === "limit")
    return end(x, {
      label: `Stopped after ${lookups} lookups, at this answer's limit`,
      state: "failed",
    });
  const line = why === "refused" ? "The model declined to answer this." : "The sources do not say.";
  x.text = "";
  x.answer.replaceChildren(h("p", { className: "says-nothing" }, line));
  x.cards.unused();
  end(x);
}

function write(x: Exchange, text: string): void {
  x.text = text;
  if (text) x.work.writing();
  x.answer.classList.toggle("is-writing", text !== "");
  x.draw(text, true);
}

function source(x: Exchange, s: Omit<Source, "n">): void {
  if (x.sources.has(s.ref)) return;
  const shown = { ...s, n: x.sources.size + 1 };
  x.sources.set(s.ref, shown);
  x.cards.add(shown);
}

function on(x: Exchange, e: AskEvent) {
  switch (e.type) {
    case "step":
      return x.work.step(e.id, e);
    case "activity":
      return x.work.step(-1, { kind: "note", state: "running", label: e.label });
    case "source":
      return source(x, e.source);
    case "cite":
      return x.cards.cite(e.ref);
    case "restart":
      return write(x, "");
    case "text":
      return write(x, x.text + e.text);
    case "no-answer":
      return unanswered(x, e.why);
    case "done":
      return end(x);
    case "failed":
      return end(x, { label: FAILED[e.why], state: "failed" });
  }
}

export function exchange(question: string) {
  const x = made(question);
  return {
    item: x.item,
    on: (e: AskEvent) => on(x, e),
    stopped: () => {
      end(x, { label: "Stopped", state: "stopped" });
      say(x, "Stopped before the answer was finished.");
    },
    failed: () => end(x, { label: FAILED.other, state: "failed" }),
    busy: () => {
      end(x, { label: "Another answer is being written for this sign-in", state: "failed" });
      say(x, "Wait for it to finish, or stop it in its tab, then ask again.");
    },
    answered: () => x.text,
  };
}
