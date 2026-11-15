import { status } from "./api.js";
import { h, one } from "./dom.js";
import { SignedOut, signOut } from "./session.js";
import type { Status } from "./types.js";

/**
 * The status corner: whether the engine answers, how many documents it holds, and in which collections. Read on start
 * and whenever the tab comes back into view; the screens that depend on it listen.
 */

const button = one(".status");
const line = one(".status-line");
const card = one(".status-card");
const listeners: ((s: Status | null) => void)[] = [];
let latest: Status | null = null;

export const onStatus = (then: (s: Status | null) => void) => {
  listeners.push(then);
  then(latest);
};

const documents = (n: number) => `${n.toLocaleString("en-GB")} document${n === 1 ? "" : "s"}`;
const collectionName = (name: string) => (name === "." ? "Top level" : name);

function drawCard(s: Status): void {
  card.replaceChildren(
    h("p", { className: "eyebrow" }, "Engine"),
    h("p", { className: "card-line" }, h("span", { className: "dot" }), "Reachable"),
    h("p", { className: "card-line" }, documents(s.documents)),
    h(
      "ul",
      { className: "card-list" },
      ...s.collections.map((c) =>
        h(
          "li",
          {},
          h("span", {}, collectionName(c.name)),
          h("span", { className: "mono" }, String(c.documents)),
        ),
      ),
    ),
    h(
      "p",
      { className: "card-line mono" },
      s.ask.ready
        ? `Ask answers with ${s.ask.answering}`
        : s.ask.needs
          ? `Ask needs ${s.ask.needs}`
          : "Ask has no answerer",
    ),
    leave(),
  );
}

/** Signing out here ends the sign-in at the server; the token signs in again. */
function leave(): HTMLElement {
  const out = h("button", { className: "quiet-button card-out", type: "button" }, "Sign out");
  out.addEventListener("click", () => {
    card.hidePopover();
    void signOut();
  });
  return out;
}

export async function refreshStatus(): Promise<void> {
  try {
    latest = await status();
    button.dataset.state = "up";
    line.textContent = documents(latest.documents);
    drawCard(latest);
  } catch (err) {
    if (err instanceof SignedOut) return;
    latest = null;
    button.dataset.state = "down";
    line.textContent = "Not reachable";
    card.replaceChildren(
      h(
        "p",
        { className: "card-line" },
        "The engine is not answering. ",
        h("code", {}, "./engine status"),
        " says why.",
      ),
    );
  }
  for (const then of listeners) then(latest);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshStatus();
});
