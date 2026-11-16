import { type AskEvent, ask, Busy } from "./ask-stream.js";
import { one, scrolling } from "./dom.js";
import { exchange } from "./exchange.js";
import { command, field } from "./field.js";
import { SignedOut } from "./session.js";
import { onStatus } from "./status.js";
import type { Status } from "./types.js";

/**
 * Ask: a question in, an answer streamed back with numbered citations, and above it the trail of what the engine did
 * to find it. One answer at a time; Stop really stops (the server aborts the model's request). Follow-ups carry the
 * thread's earlier questions and answers, and nothing outlives the page.
 */

const thread = one(".thread");
const composer = one<HTMLFormElement>(".composer");
const box = one<HTMLTextAreaElement>(".composer-input");
const history: { question: string; answer: string }[] = [];
let running: AbortController | undefined;

/** Keeps the page at the end of what is being written, unless the reader has scrolled away from it. */
function following(update: () => void): void {
  const page = document.documentElement;
  const atEnd = innerHeight + scrollY >= page.scrollHeight - 96;
  update();
  if (atEnd) scrollTo({ top: page.scrollHeight });
}

/** How long a question waits for the sign-in's last answer to be let go: a Stop reaches the server a moment later. */
const FREE_WAIT_MS = 2_000;

async function askWhenFree(...args: Parameters<typeof ask>): Promise<void> {
  for (let waited = 0; ; waited += 250) {
    try {
      return await ask(...args);
    } catch (err) {
      if (!(err instanceof Busy) || waited >= FREE_WAIT_MS || args[1].aborted) throw err;
      await new Promise((done) => setTimeout(done, 250));
    }
  }
}

async function send(question: string): Promise<void> {
  const shown = exchange(question);
  thread.querySelector(".field")?.remove();
  thread.append(shown.item);
  shown.item.scrollIntoView({ block: "start", behavior: scrolling() });
  running = new AbortController();
  composer.classList.add("is-running");
  try {
    const each = (e: AskEvent) => following(() => shown.on(e));
    await askWhenFree({ question, history: history.slice(-6) }, running.signal, each);
    history.push({ question, answer: shown.answered() });
  } catch (err) {
    if (err instanceof SignedOut) return;
    if (running?.signal.aborted) shown.stopped();
    else if (err instanceof Busy) shown.busy();
    else shown.failed();
  } finally {
    running = undefined;
    composer.classList.remove("is-running");
  }
}

function welcome(s: Status | null): void {
  if (thread.querySelector(".exchange")) return;
  const notReady = s !== null && !s.ask.ready;
  const noKey = s && !s.ask.ready ? (s.ask.needs ?? null) : null;
  box.disabled = notReady;
  thread.replaceChildren(
    notReady && !noKey
      ? field({
          eyebrow: "Ask",
          title: "Ask has no answerer.",
          lines: [
            "Name one in engine.config.ts, then start the engine again. Search works without one.",
            command('answerer: agent({ model: anthropic({ model: "claude-sonnet-5-5" }) })'),
            command("./engine down && ./engine up"),
          ],
        })
      : noKey
        ? field({
            eyebrow: "Ask",
            title: "Ask needs a model key.",
            lines: [
              "Add yours to the engine's settings in .env, then start it again. Search works without one.",
              command(`${noKey}=…`),
              command("./engine down && ./engine up"),
            ],
          })
        : field({
            eyebrow: "Ask",
            title: "Ask your documents.",
            lines: ["Answers come from what you loaded, citing the documents they were found in."],
          }),
  );
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (running) return running.abort();
  const question = box.value.trim();
  if (!question) return;
  box.value = "";
  fit();
  void send(question);
});
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
/** The box grows with what is typed, to five lines or so, and back. */
function fit(): void {
  box.style.height = "auto";
  box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
}
box.addEventListener("input", fit);
onStatus(welcome);
/** The thread keeps the dock's height free at its end, whatever the composer grows to. */
new ResizeObserver(([entry]) => {
  const height = entry?.borderBoxSize[0]?.blockSize ?? 0;
  if (height) thread.style.setProperty("--dock-height", `${Math.ceil(height)}px`);
}).observe(one(".dock"));

export const focusAsk = () => box.focus();
