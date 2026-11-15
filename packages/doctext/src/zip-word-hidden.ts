/**
 * The runs a Word author hid, so a public page shows only what the author left showing. A run is hidden by its own
 * `w:vanish` or `w:webHidden`, else its character style, else its paragraph's style, else the document's defaults;
 * each level may turn it off again. Runs nest (a text box holds runs inside a run), so they are matched by depth in
 * one linear pass over the tags, and a hidden run takes everything inside it.
 */
import { attrValue, firstTag } from "./tag-attrs.js";
import { localName, type XmlToken, xmlTokens } from "./tags.js";

/** What `styles.xml` says hides text: character styles, paragraph styles, and the document's own default. */
export type HiddenStyles = {
  /** A style that says, itself or through `w:basedOn`, whether its text is hidden: `true` hides, `false` shows. */
  character: ReadonlyMap<string, boolean>;
  paragraph: ReadonlyMap<string, boolean>;
  byDefault: boolean;
};

/** A Word part with its hidden runs removed. */
export function withoutHiddenRuns(xml: string, styles: HiddenStyles): string {
  const walk: Walk = { xml, styles, stack: [], cut: [] };
  // One pass over the tokenizer's tags: a pattern retried from every `<w:r` is quadratic on a flood.
  for (const t of xmlTokens(xml)) {
    // By local name, whatever the prefix: a part may bind WordprocessingML to any prefix (`x:r`).
    if (t.kind !== "tag" || t.selfClosing || !FRAMES.has(localName(t.name))) continue;
    const name = localName(t.name);
    if (name === "p" || name === "r") frameTag(walk, t, name);
    else propsTag(walk, t, name);
  }
  return cutOut(xml, walk.cut);
}

/**
 * The styles that hide their text: a character or paragraph style whose own run properties turn on `w:vanish` or
 * `w:webHidden`, or that inherits it through `w:basedOn` (followed at most ten deep); and whether the document's
 * defaults (`w:docDefaults` → `w:rPrDefault`) hide every run that does not say otherwise.
 */
export function hiddenStyles(stylesXml: string | undefined): HiddenStyles {
  const own = stylesXml ? ownStyles(stylesXml) : new Map<string, Own>();
  const byDefault = stylesXml ? defaultHides(stylesXml) : false;
  const character = new Map<string, boolean>();
  const paragraph = new Map<string, boolean>();
  for (const [id, first] of own) {
    let step: string | undefined = id;
    for (let depth = 0; step !== undefined && depth < 10; depth++) {
      const style = own.get(step);
      if (!style) break;
      if (style.hides !== undefined) {
        (first.type === "character" ? character : paragraph).set(id, style.hides);
        break;
      }
      step = style.basedOn;
    }
  }
  return { character, paragraph, byDefault };
}

/** The `val` of the first `<name …>` in `xml`, either of them under any prefix (`firstTag`). */
export const wVal = (xml: string, name: string): string | undefined => firstTag(xml, name)?.val;

const FRAMES = new Set(["r", "rPr", "p", "pPr"]);
type Run = { kind: "r"; start: number; propsAt: number; props: string | null };
type Para = { kind: "p"; propsAt: number; hidden: boolean };
type Walk = { xml: string; styles: HiddenStyles; stack: (Run | Para)[]; cut: [number, number][] };
type Tag = Extract<XmlToken, { kind: "tag" }>;

/** A run or paragraph opens a frame; its close cuts the run when it is hidden. */
function frameTag(walk: Walk, t: Tag, name: "p" | "r"): void {
  const { stack, styles } = walk;
  if (!t.closing) {
    stack.push(
      name === "p"
        ? { kind: "p", propsAt: -1, hidden: styles.byDefault }
        : { kind: "r", start: t.start, propsAt: -1, props: null },
    );
    return;
  }
  // Close the innermost frame of this kind (a malformed part closes what it can).
  let k = stack.length - 1;
  while (k >= 0 && stack[k]?.kind !== name) k--;
  if (k < 0) return;
  const [frame] = stack.splice(k, 1);
  if (
    frame?.kind === "r" &&
    runHidden(frame.props ?? "", styles, paragraphOf(stack)?.hidden ?? styles.byDefault)
  )
    walk.cut.push([frame.start, t.end]);
}

/** A frame's own properties: the first `<w:rPr>`/`<w:pPr>` directly inside it, before anything it holds. */
function propsTag(walk: Walk, t: Tag, name: string): void {
  const top = walk.stack[walk.stack.length - 1];
  const owner =
    name === "rPr" ? (top?.kind === "r" ? top : undefined) : top?.kind === "p" ? top : undefined;
  if (!owner) return;
  if (!t.closing && owner.propsAt === -1) owner.propsAt = t.start;
  else if (t.closing && owner.propsAt >= 0) {
    const props = walk.xml.slice(owner.propsAt, t.start);
    owner.propsAt = -2;
    if (owner.kind === "r") owner.props = props;
    else {
      const style = wVal(props, "pStyle");
      const says = style === undefined ? undefined : walk.styles.paragraph.get(style);
      if (says !== undefined) owner.hidden = says;
    }
  }
}

function paragraphOf(stack: (Run | Para)[]): Para | undefined {
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k];
    if (frame?.kind === "p") return frame;
  }
  return undefined;
}

function cutOut(xml: string, cut: [number, number][]): string {
  if (cut.length === 0) return xml;
  cut.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [from, to] of cut) {
    if (from < at) continue; // inside a run already cut
    out += xml.slice(at, from);
    at = to;
  }
  return out + xml.slice(at);
}

/** Whether a run is hidden: its own toggles, else its character style, else its paragraph's (or the default). */
function runHidden(props: string, styles: HiddenStyles, paragraphHidden: boolean): boolean {
  for (const tag of ["vanish", "webHidden"]) {
    const own = toggle(props, tag);
    if (own !== undefined) return own;
  }
  const style = wVal(props, "rStyle");
  const says = style === undefined ? undefined : styles.character.get(style);
  return says ?? paragraphHidden;
}

type Own = { type: string; hides: boolean | undefined; basedOn: string | undefined };

function defaultHides(stylesXml: string): boolean {
  const defaults = stylesXml.indexOf("<w:rPrDefault");
  if (defaults === -1) return false;
  const end = stylesXml.indexOf("</w:rPrDefault>", defaults);
  const props = stylesXml.slice(defaults, end === -1 ? undefined : end);
  return toggle(props, "vanish") === true || toggle(props, "webHidden") === true;
}

/** Each character and paragraph style's own say on hiding, and the style it is based on. */
function ownStyles(stylesXml: string): Map<string, Own> {
  const own = new Map<string, Own>();
  let at = stylesXml.indexOf("<w:style ");
  while (at !== -1) {
    const end = stylesXml.indexOf("</w:style>", at);
    if (end === -1) break;
    const style = stylesXml.slice(at, end);
    const open = style.slice(0, style.indexOf(">") + 1);
    const id = attrValue(open, "w:styleId");
    const type = attrValue(open, "w:type") ?? "paragraph";
    if (id && (type === "character" || type === "paragraph"))
      own.set(id, { type, hides: styleHides(style), basedOn: wVal(style, "basedOn") });
    at = stylesXml.indexOf("<w:style ", end);
  }
  return own;
}

function styleHides(style: string): boolean | undefined {
  const propsAt = style.indexOf("<w:rPr");
  const props = propsAt === -1 ? "" : style.slice(propsAt, style.indexOf("</w:rPr>", propsAt));
  const vanish = toggle(props, "vanish");
  const web = toggle(props, "webHidden");
  return vanish === true || web === true
    ? true
    : vanish === false || web === false
      ? false
      : undefined;
}

/**
 * A toggle property in a run's properties: `true` when present and on (`<w:vanish/>`, or a `w:val` other than
 * `0`/`false`/`off`), `false` when present and turned off, `undefined` when it is not said here.
 */
function toggle(props: string, tag: string): boolean | undefined {
  const found = firstTag(props, tag);
  return found && (found.val === undefined || !["0", "false", "off"].includes(found.val));
}
