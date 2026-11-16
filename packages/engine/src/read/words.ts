import type { Viewer } from "@louvain/engine-core";
import { fence, type ReadContext } from "./fence.js";
import { hooksOf } from "./hooks.js";

/** Which of these words a readable passage holds, by the build's words test, under the reader's fence. */
export async function heldWords(
  context: ReadContext,
  viewer: Viewer,
  words: readonly string[],
): Promise<Set<string>> {
  const reader = await fence(context, viewer);
  if (!reader || words.length === 0) return new Set();
  return hooksOf(context).keyword.words.held(context, reader, words);
}

/**
 * The literals a search names, each compared whole: a figure as bare digits ("2400", "2,400", "2.400", "2 400" and
 * "£2,400" are one number, and "2,400" never matches a bare "400"), and an IDENTIFIER, a token of letters and digits
 * together however hyphenated ("SUP-1042", "sup1042", a GUID), as its letters and digits alone; lower case, without
 * accents. A passage holds a figure when its text, its separators removed (`joined`), has it as a whole word, and an
 * identifier when it writes those letters and digits in order, hyphenated anywhere or not. Spaced, "sup 1042" is two
 * words and a figure.
 */
export function literalsOf(query: string): string[] {
  const q = fold(query);
  const ids = identifiersIn(q).map((w) => w.replace(/-/g, ""));
  const figures = (withoutIdentifiers(q).match(FIGURE) ?? []).map((f) => f.replace(/[ ,.]/g, ""));
  return [...new Set([...ids, ...figures])];
}

/**
 * The search's words, no literal's pieces among them: the text search holds "SUP-1042" as "sup-1042", "sup" and "1042",
 * so as words a search for one ticket matched every "SUP-" ticket, and a GUID's fragments matched any document holding
 * one of them; it holds "2,400" as "2" and "400", so "2,400" matched "400 units" and "2400" did not. Identifiers and
 * figures are literals (`literalsOf`); the words are the rest, folded.
 */
export const wordsOf = (query: string): string =>
  withoutIdentifiers(fold(query)).replace(FIGURE, " ");

/**
 * A figure as a person writes it: bare digits, or groups of three after a separator, never part of a longer number
 * ("2,400 2400" is two figures, not "2,400 240" and a stray "0").
 */
const FIGURE = /(?<![\d.,])(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?![\d]|[.,]\d)/g;

const TOKEN = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

const isIdentifier = (token: string) => /\p{L}/u.test(token) && /\p{N}/u.test(token);

const identifiersIn = (folded: string) => (folded.match(TOKEN) ?? []).filter(isIdentifier);

const withoutIdentifiers = (folded: string) =>
  folded.replace(TOKEN, (token) => (isIdentifier(token) ? " " : token));

/** Lower case, without accents: "Café" and "cafe" are one word to a person typing. */
export const fold = (text: string): string =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
