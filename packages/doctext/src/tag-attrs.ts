/** A tag's attributes by name, never by position: XML does not order them and writers do not agree. */
import { localName, xmlTokens } from "./tags.js";

/**
 * One attribute's value from a tag's raw attributes, by name (`r:id` included), or undefined. Found by `indexOf`: the
 * pattern such as `\bname="([^"]*)"` is re-tried from every occurrence of the name, and matches `r` inside `xr:r`
 * (`\b` falls between `:` and `r`).
 */
export function attrValue(attrs: string, name: string): string | undefined {
  const needle = `${name}="`;
  let at = 0;
  for (;;) {
    const found = attrs.indexOf(needle, at);
    if (found < 0) return undefined;
    // The name starts an attribute only after whitespace (or at the start): `xr:r="…"` is not `r`, `data-r` is not.
    const before = found === 0 ? " " : attrs.charAt(found - 1);
    if (/\s/.test(before)) {
      const from = found + needle.length;
      const close = attrs.indexOf('"', from);
      return close < 0 ? undefined : attrs.slice(from, close);
    }
    at = found + 1;
  }
}

/**
 * The first `<prefix:name …>` in `xml` whatever its prefix, with the value of its own `prefix:val` (a document written
 * with `x:` for WordprocessingML says `x:val`). Undefined when there is none. One pass of the tokenizer.
 */
export function firstTag(xml: string, name: string): { val: string | undefined } | undefined {
  for (const t of xmlTokens(xml)) {
    if (t.kind !== "tag" || t.closing || localName(t.name) !== name) continue;
    const colon = t.name.indexOf(":");
    return { val: attrValue(t.attrs, `${colon < 0 ? "" : t.name.slice(0, colon + 1)}val`) };
  }
  return undefined;
}
