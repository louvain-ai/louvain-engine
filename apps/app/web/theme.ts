import { one } from "./dom.js";

/**
 * Light, dark, or the system's: one button cycles them, and the choice is kept in this browser
 * (`theme-boot.js` applies it before the first paint).
 */

const KEY = "louvain-engine-theme";
const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];
const LABELS: Record<Theme, string> = { system: "follow the system", light: "light", dark: "dark" };

const button = one(".theme");

function apply(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  button.dataset.theme = theme;
  button.ariaLabel = `Theme: ${LABELS[theme]}`;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // swallowed: storage refused (a private window) keeps the choice for this page only.
  }
}

const current = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ?? "system";

button.addEventListener("click", () =>
  apply(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length] ?? "system"),
);
apply(current());
