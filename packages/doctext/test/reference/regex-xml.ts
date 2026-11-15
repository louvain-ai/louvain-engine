/**
 * The regex scanner that `tags.ts` supersedes, kept only as the reference the differential test (`test/tags.test.ts`) reads
 * the linear one against. It is quadratic on hostile markup: never import it from `src/`.
 */
import { decodeEntities } from "../../src/text.js";

/**
 * Text out of XML, in document order, with structure decided by the caller.
 *
 * Why not a parser: every format read here (OOXML, ODF, EPUB) is XML written
 * by a machine, and what is wanted from it is one thing: the character data,
 * in order, with a line break where the format says a paragraph ended. A DOM
 * would build a tree of a hundred thousand nodes for a document whose text is
 * read once and thrown away, and an XML dependency would have to be trusted
 * with untrusted input from a mailbox. A scanner over tags cannot be confused
 * into executing anything, and its failure mode on malformed input is a
 * missing line break rather than an exception.
 *
 * The one thing it must get right is which elements to skip entirely —
 * `<style>` in an EPUB, a field code in a .docx — because their content is
 * character data too, and left in it becomes a passage that is then embedded
 * and offered as evidence.
 */
type XmlRules = {
  /** Local names whose end emits a newline. */
  breakAfter?: Set<string>;
  /** Local names whose end emits a tab — a table cell, so a row stays one line. */
  tabAfter?: Set<string>;
  /** Local names whose entire subtree is dropped. */
  skip?: Set<string>;
  /**
   * Called with the local name on open and close, to let a format keep state
   * a flat scan cannot — whether a paragraph is inside a table, say.
   */
  onElement?: (name: string, open: boolean) => void;
  /**
   * What this element's end emits, decided with whatever state `onElement`
   * kept. `null` means "no opinion" and falls through to the sets above.
   */
  endsWith?: (name: string) => string | null;
};

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const COMMENT = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g;

const local = (name: string): string => {
  const colon = name.indexOf(":");
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase();
};

export function referenceXmlText(xml: string, rules: XmlRules = {}): string {
  // CDATA is character data and is kept; comments, processing instructions
  // and doctypes are not.
  const source = xml.replace(COMMENT, (_m, cdata?: string) => cdata ?? " ");
  const out: string[] = [];
  let cursor = 0;
  let skipping: string | null = null;
  let skipDepth = 0;
  TAG.lastIndex = 0;
  let match = TAG.exec(source);
  while (match !== null) {
    if (skipping === null && match.index > cursor)
      out.push(decodeEntities(source.slice(cursor, match.index)));
    const closing = match[1] === "/";
    const name = local(match[2] ?? "");
    const selfClosing = match[4] === "/";

    if (skipping !== null) {
      if (name === skipping && !selfClosing) skipDepth += closing ? -1 : 1;
      if (skipDepth <= 0) skipping = null;
    } else if (rules.skip?.has(name) && !closing && !selfClosing) {
      skipping = name;
      skipDepth = 1;
    } else {
      if (!selfClosing) rules.onElement?.(name, !closing);
      if (closing || selfClosing) {
        const override = rules.endsWith?.(name);
        if (override !== undefined && override !== null) out.push(override);
        else if (rules.breakAfter?.has(name)) out.push("\n");
        else if (rules.tabAfter?.has(name)) out.push("\t");
      }
    }
    cursor = match.index + match[0].length;
    match = TAG.exec(source);
  }
  if (skipping === null && cursor < source.length) out.push(decodeEntities(source.slice(cursor)));
  return out.join("");
}
