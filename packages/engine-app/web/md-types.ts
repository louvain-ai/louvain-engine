/**
 * The tokens of marked's lexer as the app reads them: only the fields the renderer and the snippet read are typed.
 * The lexer itself is `lexer.ts`.
 */

export type Cell = { text: string; tokens: Token[] };

export type Token = {
  type: string;
  /** The source text; a task list's checkbox has none. */
  raw?: string;
  text?: string;
  tokens?: Token[];
  depth?: number;
  ordered?: boolean;
  start?: number | "";
  items?: Token[];
  header?: Cell[];
  rows?: Cell[][];
  align?: ("left" | "center" | "right" | null)[];
  href?: string;
  checked?: boolean;
};
