import { focusAsk } from "./ask.js";
import { closeReader } from "./reader.js";
import { focusSearch } from "./search.js";
import { onSignedOut } from "./session.js";
import { askToSignIn } from "./signin.js";
import { refreshStatus } from "./status.js";
import "./theme.js";

/**
 * The app: two views, Search and Ask, chosen by the address's `#`, and a sign-in that stands in front of both and asks
 * for the engine's token once.
 */

const VIEWS = { search: focusSearch, ask: focusAsk } as const;
type View = keyof typeof VIEWS;
let signedOut = false;

function show(view: View | "signin"): void {
  document.body.dataset.view = view;
  for (const section of document.querySelectorAll<HTMLElement>(".view"))
    section.hidden = section.id !== `view-${view}`;
  for (const tab of document.querySelectorAll<HTMLAnchorElement>(".tab"))
    tab.ariaCurrent = tab.dataset.view === view ? "page" : null;
}

function route(): void {
  if (signedOut) return;
  const view: View = location.hash === "#ask" ? "ask" : "search";
  closeReader();
  show(view);
  // A phone opens its keyboard on focus, so only a page with a pointer that hovers takes the caret on arrival.
  if (matchMedia("(hover: hover)").matches) VIEWS[view]();
}

onSignedOut(() => {
  signedOut = true;
  show("signin");
  askToSignIn(() => {
    signedOut = false;
    route();
    void refreshStatus();
  });
});

window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key !== "/" || typing || signedOut || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  if (location.hash === "#ask") focusAsk();
  else focusSearch();
});

route();
void refreshStatus();
