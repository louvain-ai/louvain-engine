/** Elements and tags by local name, found through the tokenizer: lazy, so a caller that stops at a cap stops the scan. */
import { localName, xmlTokens } from "./tags.js";

export type XmlElement = { attrs: string; inner: string; selfClosing: boolean };

/**
 * Every element whose local name is `name` (exact case), in order, with its raw inner XML — the first matching close
 * ends it, as a lazy pattern would. A self-closing one has an empty inner. An element never closed
 * yields nothing. Lazy, so a caller that stops at a cap stops the scan.
 */
export function* xmlElements(xml: string, name: string): Generator<XmlElement> {
  let open: { attrs: string; from: number } | null = null;
  for (const t of xmlTokens(xml)) {
    if (t.kind !== "tag" || localName(t.name) !== name) continue;
    if (open === null) {
      if (t.closing) continue;
      if (t.selfClosing) yield { attrs: t.attrs, inner: "", selfClosing: true };
      else open = { attrs: t.attrs, from: t.end };
    } else if (t.closing) {
      yield { attrs: open.attrs, inner: xml.slice(open.from, t.start), selfClosing: false };
      open = null;
    }
  }
}

/** The first such element, or null. */
export function firstElement(xml: string, name: string): XmlElement | null {
  for (const element of xmlElements(xml, name)) return element;
  return null;
}

/** The attributes of every opening or self-closing tag whose local name is `name` (exact case), in order. */
export function* xmlTagAttrs(xml: string, name: string): Generator<string> {
  for (const t of xmlTokens(xml))
    if (t.kind === "tag" && !t.closing && localName(t.name) === name) yield t.attrs;
}
