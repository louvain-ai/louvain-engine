/**
 * One pass over XML, linear in the input: the tokenizer every Office and OpenDocument read goes through. Every
 * character is looked at a bounded number of times: a tag is consumed once it closes, a comment, CDATA section,
 * instruction or declaration is found by `indexOf` for its terminator, and markup with no terminator ends the scan,
 * text included. Nothing here builds a tree or expands a character reference, so it cannot be made to allocate one.
 */

export type XmlToken =
  | { kind: "text"; start: number; end: number }
  /** A comment, a processing instruction or a declaration: nothing, but it separates the text around it. */
  | { kind: "gap" }
  | { kind: "cdata"; start: number; end: number }
  | {
      kind: "tag";
      /** The name as written, prefix included (`w:p`). */
      name: string;
      closing: boolean;
      selfClosing: boolean;
      /** What sits between the name and `>` (or `/>`), raw. */
      attrs: string;
      /** Index of the `<`, and of the character after the `>`. */
      start: number;
      end: number;
    };

const NAME = /<(\/?)([A-Za-z_][\w.:-]*)/y;
const QUOTE = 34;
const APOSTROPHE = 39;
const GT = 62;

/** The tokens of `xml` in order; a `<` that opens nothing is a character of the text. */
export function* xmlTokens(xml: string): Generator<XmlToken> {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      yield { kind: "text", start: i, end: n };
      return;
    }
    if (lt > i) yield { kind: "text", start: i, end: lt };
    const markup = declaration(xml, lt);
    if (markup) {
      if (markup.next < 0) return;
      yield markup.token;
      i = markup.next;
      continue;
    }
    NAME.lastIndex = lt;
    const name = NAME.exec(xml);
    if (!name) {
      yield { kind: "text", start: lt, end: lt + 1 };
      i = lt + 1;
      continue;
    }
    const attrsStart = NAME.lastIndex;
    const j = tagEnd(xml, attrsStart);
    if (j < 0) return;
    const selfClosing = j > attrsStart && xml.charAt(j - 1) === "/";
    yield {
      kind: "tag",
      name: name[2] ?? "",
      closing: name[1] === "/",
      selfClosing,
      attrs: xml.slice(attrsStart, selfClosing ? j - 1 : j),
      start: lt,
      end: j + 1,
    };
    i = j + 1;
  }
}

/**
 * The comment, CDATA section, instruction or declaration opening at `lt`, and where the scan resumes after it
 * (-1 when it has no terminator, which ends the scan); null when `lt` opens none of them.
 */
function declaration(xml: string, lt: number): { token: XmlToken; next: number } | null {
  if (xml.startsWith("<!--", lt)) {
    const close = xml.indexOf("-->", lt + 4);
    return { token: { kind: "gap" }, next: close < 0 ? -1 : close + 3 };
  }
  if (xml.startsWith("<![CDATA[", lt)) {
    const close = xml.indexOf("]]>", lt + 9);
    return {
      token: { kind: "cdata", start: lt + 9, end: close },
      next: close < 0 ? -1 : close + 3,
    };
  }
  if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
    const close = xml.indexOf(xml.charAt(lt + 1) === "?" ? "?>" : ">", lt + 2);
    return {
      token: { kind: "gap" },
      next: close < 0 ? -1 : close + (xml.charAt(lt + 1) === "?" ? 2 : 1),
    };
  }
  return null;
}

/** The index of the `>` that closes a tag whose attributes start at `from`, past quoted values; -1 when none does. */
function tagEnd(xml: string, from: number): number {
  const n = xml.length;
  let j = from;
  for (;;) {
    if (j >= n) return -1;
    const c = xml.charCodeAt(j);
    if (c === QUOTE || c === APOSTROPHE) {
      const close = xml.indexOf(c === QUOTE ? '"' : "'", j + 1);
      if (close < 0) return -1;
      j = close + 1;
      continue;
    }
    if (c === GT) return j;
    j++;
  }
}

/** A name without its namespace prefix (`w:p` → `p`), as written. */
export const localName = (name: string): string => {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
};
