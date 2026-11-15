import { citations } from "./cite.js";
import type { Cell, Token } from "./md-types.js";

/**
 * An answer's markdown, as a tree of what the page allows. The lexer's tokens become a closed set of elements
 * (paragraphs, headings, lists, tables, quotes, code, emphasis), text, citation chips and links to a source shown in
 * this answer; every other token (raw HTML, an image, a link anywhere else) becomes its own text. Nothing here makes
 * an attribute from what the answer wrote, so no text can become markup. Pure: the page builds the elements.
 */

type Tag =
  | "p"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "pre"
  | "code"
  | "strong"
  | "em"
  | "del"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "hr"
  | "br";

export type Tree =
  | string
  | { tag: Tag; kids: Tree[]; align?: "center" | "right"; start?: number }
  | { cite: string[]; glue: string }
  | { open: string; kids: Tree[] };

/** Whether a ref was minted for this answer: only those become chips or links. */
type Known = (ref: string) => boolean;

const el = (tag: Tag, kids: Tree[] = []): Tree => ({ tag, kids });

function leaf(text: string, known: Known): Tree[] {
  return citations(text, known).map((p) =>
    typeof p === "string" ? p : { cite: p.refs, glue: p.glue },
  );
}

function inline(tokens: readonly Token[] | undefined, known: Known): Tree[] {
  return (tokens ?? []).flatMap((t): Tree[] => {
    switch (t.type) {
      case "text":
        return t.tokens ? inline(t.tokens, known) : leaf(t.text ?? "", known);
      case "escape":
        return leaf(t.text ?? "", known);
      case "strong":
      case "em":
      case "del":
        return [el(t.type, inline(t.tokens, known))];
      case "codespan":
        return [el("code", [t.text ?? ""])];
      case "br":
        return [el("br")];
      case "link":
        return link(t, known);
      case "image":
        return leaf(t.text ?? "", known);
      default:
        return t.raw ? [t.raw] : [];
    }
  });
}

/** A link stays a link only to a source shown in this answer, by its ref; any other is its words. */
function link(t: Token, known: Known): Tree[] {
  const ref = /^#?([a-z0-9]{4,32})$/i.exec(t.href ?? "")?.[1]?.toLowerCase();
  const kids = inline(t.tokens, known);
  return ref && known(ref) ? [{ open: ref, kids }] : kids;
}

/** An answer's headings sit under its question's: its first two levels are the page's third, then one each. */
const heading = (depth: number) => `h${Math.min(6, Math.max(3, depth + 1))}` as Tag;

function list(t: Token, known: Known): Tree {
  const items = (t.items ?? []).map((item) => el("li", blocks(item.tokens ?? [], known)));
  if (!t.ordered) return el("ul", items);
  const start = typeof t.start === "number" && t.start !== 1 ? { start: t.start } : {};
  return { tag: "ol", kids: items, ...start };
}

function table(t: Token, known: Known): Tree {
  const cell = (tag: "th" | "td", c: Cell, at: number): Tree => {
    const align = t.align?.[at];
    const kids = inline(c.tokens, known);
    return align === "center" || align === "right" ? { tag, kids, align } : el(tag, kids);
  };
  const head = el(
    "tr",
    (t.header ?? []).map((c, at) => cell("th", c, at)),
  );
  const rows = (t.rows ?? []).map((r) =>
    el(
      "tr",
      r.map((c, at) => cell("td", c, at)),
    ),
  );
  return el("table", [el("thead", [head]), el("tbody", rows)]);
}

function block(t: Token, known: Known): Tree[] {
  switch (t.type) {
    case "paragraph":
      return [el("p", inline(t.tokens, known))];
    case "heading":
      return [el(heading(t.depth ?? 1), inline(t.tokens, known))];
    case "text":
      return t.tokens ? inline(t.tokens, known) : leaf(t.text ?? "", known);
    case "code":
      return [el("pre", [el("code", [t.text ?? ""])])];
    case "blockquote":
      return [el("blockquote", blocks(t.tokens ?? [], known))];
    case "list":
      return [list(t, known)];
    case "table":
      return [table(t, known)];
    case "hr":
      return [el("hr")];
    case "checkbox":
      return [t.checked ? "☑ " : "☐ "];
    case "space":
    case "def":
      return [];
    default:
      return t.raw?.trim() ? [el("p", [t.raw.trim()])] : [];
  }
}

export function blocks(tokens: readonly Token[], known: Known): Tree[] {
  return tokens.flatMap((t) => block(t, known));
}
