import type { Token } from "./md-types.js";

/**
 * Marked's lexer, which turns markdown into tokens and never into HTML. The `marked` package (pinned, MIT) is a
 * dependency of the app, and its server serves the package's own module at this URL beside the page's script
 * (`src/static.ts`): no copy of it is kept here. The URL is the page's, so it is a value, not a source import.
 */
const MARKED = "./vendor/marked.js";
const { Lexer } = (await import(MARKED)) as {
  Lexer: { lex(src: string, options: { gfm: boolean }): Token[] };
};

/** Markdown as tokens, GitHub's flavour. */
export const lex = (markdown: string): Token[] => Lexer.lex(markdown, { gfm: true });
