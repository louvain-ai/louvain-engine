import { h } from "./dom.js";
import { ribbon } from "./ribbon.js";

/**
 * The field: the one place colour is allowed. A deep violet panel with the ribbon at its edge, for
 * the moments with something to say before there is anything to show: nothing loaded, nothing asked, no key.
 */

export function field(o: {
  eyebrow: string;
  title: string;
  lines?: (string | Node)[];
  action?: Node;
}): HTMLElement {
  return h(
    "section",
    { className: "field" },
    ribbon(),
    h(
      "div",
      { className: "field-words" },
      h("p", { className: "eyebrow" }, o.eyebrow),
      h("h1", { className: "field-title display" }, o.title),
      ...(o.lines ?? []).map((line) => h("p", { className: "field-line" }, line)),
      o.action ?? null,
    ),
  );
}

/** A command to type, set as code the reader can select whole. */
export const command = (text: string): HTMLElement => h("code", { className: "command" }, text);
