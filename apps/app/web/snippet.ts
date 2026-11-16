import type { Token } from "./md-types.js";

/**
 * A snippet is words, not a page: a passage the engine sends may be markdown, and under a result it reads as one or
 * two plain lines. The lexer's tokens give the words without their marks (a heading's `#`, a list's `-`, emphasis,
 * code ticks), blocks part with a space, and nothing becomes an element. Pure: tokens in, text out.
 */

function words(t: Token): string {
  switch (t.type) {
    case "space":
    case "hr":
    case "br":
      return " ";
    case "list":
      return (t.items ?? []).map(words).join(" ");
    case "list_item":
    case "blockquote":
      return joined(t.tokens ?? [], " ");
    case "table":
      return [t.header ?? [], ...(t.rows ?? [])]
        .flat()
        .map((c) => c.text)
        .join(" ");
    case "codespan":
    case "code":
    case "escape":
      return t.text ?? "";
    default:
      // A block's own words, or an inline token's: the pieces of one line, joined as written.
      return t.tokens ? joined(t.tokens, "") : (t.text ?? t.raw ?? "");
  }
}

const joined = (tokens: readonly Token[], between: string): string =>
  tokens.map(words).join(between);

/** A passage's words on one line, its blocks parted by a space. */
export const plainText = (tokens: readonly Token[]): string =>
  joined(tokens, " ").replace(/\s+/g, " ").trim();
