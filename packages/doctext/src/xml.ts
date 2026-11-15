/**
 * Text out of XML, in document order, with the structure the caller decides, in one pass over the tokenizer. A
 * scanner, not a parser: machine-written XML read once needs no tree, and a scanner given hostile input cannot be
 * made to run anything; its failure on malformed input is a missing line break. What it must get right is which
 * elements to skip whole (an EPUB's `<style>`, a field code), because their content is character data too.
 */

import { localName, type XmlToken, xmlTokens } from "./tags.js";
import { decodeEntities } from "./text.js";

export type XmlRules = {
  /** Local names whose end emits a newline. */
  breakAfter?: Set<string>;
  /** Local names whose end emits a tab — a table cell, so a row stays one line. */
  tabAfter?: Set<string>;
  /** Local names whose entire subtree is dropped. */
  skip?: Set<string>;
  /**
   * Character data counts only inside these elements (local names): the elements a format keeps what a person typed
   * in (`a:t`). Every other element's text is a property the format writes — a table's style id, a theme name —
   * and is not content; skipping known property elements one by one is a list that a new producer outruns.
   * Structure (`breakAfter`, `tabAfter`, `endsWith`) is unaffected.
   */
  only?: Set<string>;
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

const ALTERNATE = "alternatecontent";
const CHOICE = "choice";
const FALLBACK = "fallback";
const ALTERNATE_DEPTH = 16;

type AlternateFrame = {
  /** Where the block's chosen branch goes once it closes. */
  parent: string[];
  /** Where anything outside a branch goes (nothing is read there; kept so `out` is never the parent's). */
  scratch: string[];
  /** Open elements inside the block: 0 is the block's own level, where `Choice` and `Fallback` sit. */
  depth: number;
  branch: typeof CHOICE | typeof FALLBACK | null;
  /** The branch being read. */
  current: string[] | null;
  chosen?: string[];
  fallback?: string[];
};

/** A branch ended: the first `Choice` with words is kept, and the `Fallback` is held in case none has any. */
function endBranch(frame: AlternateFrame): void {
  const buffer = frame.current;
  const branch = frame.branch;
  frame.branch = null;
  frame.current = null;
  if (branch === null || buffer === null) return;
  if (branch === CHOICE) {
    if (frame.chosen === undefined && /\S/.test(buffer.join(""))) frame.chosen = buffer;
  } else frame.fallback ??= buffer;
}

export function xmlText(xml: string, rules: XmlRules = {}): string {
  const walk = new TextWalk(xml, rules);
  for (const t of xmlTokens(xml)) {
    if (t.kind === "tag") walk.tag(t);
    else walk.text(t);
  }
  return walk.end();
}

type Tag = Extract<XmlToken, { kind: "tag" }>;

/**
 * One pass's state. CDATA is character data and is kept; comments, instructions and doctypes separate the text
 * around them. An alternate-content block's branches read into their own buffers and one is kept at its close;
 * nesting past `ALTERNATE_DEPTH` reads as ordinary elements, so the copying stays bounded.
 */
class TextWalk {
  private out: string[] = [];
  private readonly frames: AlternateFrame[] = [];
  private skipping: string | null = null;
  private skipDepth = 0;
  // The character data between two tags is decoded as one string (a gap is a space in it): `decodeEntities`
  // collapses a run of spaces. Adjacent text tokens extend one slice, so a flood of `<` builds no rope.
  private readonly run: string[] = [];
  private within = 0;
  private from = -1;
  private to = -1;

  constructor(
    private readonly xml: string,
    private readonly rules: XmlRules,
  ) {}

  text(t: Exclude<XmlToken, { kind: "tag" }>): void {
    if (this.skipping !== null || (this.rules.only && this.within === 0)) return;
    if (t.kind === "gap") {
      this.close();
      this.run.push(" ");
    } else if (this.from >= 0 && t.start === this.to) this.to = t.end;
    else {
      this.close();
      this.from = t.start;
      this.to = t.end;
    }
  }

  tag(t: Tag): void {
    this.flush();
    const name = localName(t.name).toLowerCase();
    if (this.skipping !== null) {
      if (name === this.skipping && !t.selfClosing) this.skipDepth += t.closing ? -1 : 1;
      if (this.skipDepth <= 0) this.skipping = null;
    } else if (this.rules.skip?.has(name) && !t.closing && !t.selfClosing) {
      this.skipping = name;
      this.skipDepth = 1;
    } else if (!this.alternateStep(t, name)) this.element(t, name);
  }

  end(): string {
    this.flush();
    while (this.frames.length > 0) this.finish();
    return this.out.join("");
  }

  /** Steps the innermost alternate block for this tag; true when the tag closed the block itself. */
  private alternateStep(t: Tag, name: string): boolean {
    const frame = this.frames[this.frames.length - 1];
    if (!frame || t.selfClosing) return false;
    if (t.closing) {
      if (frame.depth === 0 && name === ALTERNATE) {
        this.finish();
        const parent = this.frames[this.frames.length - 1];
        if (parent) parent.depth--;
        return true;
      }
      frame.depth--;
      if (frame.depth === 0) {
        endBranch(frame);
        this.out = frame.scratch;
      }
    } else {
      if (frame.depth === 0 && (name === CHOICE || name === FALLBACK)) {
        frame.branch = name;
        frame.current = [];
        this.out = frame.current;
      }
      frame.depth++;
    }
    return false;
  }

  /** An element's own effect: a new alternate block, the caller's hooks, and what its end emits. */
  private element(t: Tag, name: string): void {
    if (
      name === ALTERNATE &&
      !t.closing &&
      !t.selfClosing &&
      this.frames.length < ALTERNATE_DEPTH
    ) {
      this.frames.push({ parent: this.out, scratch: [], depth: 0, branch: null, current: null });
      this.out = this.frames[this.frames.length - 1]?.scratch ?? this.out;
    }
    if (!t.selfClosing) {
      this.rules.onElement?.(name, !t.closing);
      if (this.rules.only?.has(name)) this.within = Math.max(0, this.within + (t.closing ? -1 : 1));
    }
    if (t.closing || t.selfClosing) {
      const override = this.rules.endsWith?.(name);
      if (override !== undefined && override !== null) this.out.push(override);
      else if (this.rules.breakAfter?.has(name)) this.out.push("\n");
      else if (this.rules.tabAfter?.has(name)) this.out.push("\t");
    }
  }

  /** The innermost alternate block closes: its chosen branch joins the text it sits in. */
  private finish(): void {
    const frame = this.frames.pop();
    if (!frame) return;
    endBranch(frame);
    this.out = frame.parent;
    this.out.push((frame.chosen ?? frame.fallback ?? []).join(""));
  }

  private close(): void {
    if (this.from >= 0) this.run.push(this.xml.slice(this.from, this.to));
    this.from = -1;
  }

  private flush(): void {
    this.close();
    if (this.run.length > 0 && this.skipping === null)
      this.out.push(decodeEntities(this.run.join("")));
    this.run.length = 0;
  }
}
