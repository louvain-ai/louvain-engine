import { parseArgs } from "node:util";

/** What `./engine search` was asked: the search words, whether to print whole ids, and the person's question. */
export type SearchArgs = { words: string; fullIds: boolean; question?: string };

export const SEARCH_USAGE =
  'usage: ./engine search [--full-ids] [--question "<question>"] "<words>"';

/**
 * The command line, read by `node:util`'s `parseArgs`: `--full-ids` anywhere, `--question <question>` (or
 * `--question=<question>`), and every other argument joined as the search words. Null when there are no words, when
 * `--question` has no value, or for a flag it does not know, so the caller prints the usage rather than searching for
 * a flag.
 */
export function searchArgs(argv: readonly string[]): SearchArgs | null {
  let parsed: { values: { "full-ids"?: boolean; question?: string }; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { "full-ids": { type: "boolean" }, question: { type: "string" } },
    });
  } catch {
    // swallowed: a command line parseArgs refuses (a missing value, an unknown flag) is the usage.
    return null;
  }
  const words = parsed.positionals.join(" ").trim();
  const question = parsed.values.question;
  if (!words || (question !== undefined && !question.trim())) return null;
  const fullIds = parsed.values["full-ids"] === true;
  return { words, fullIds, ...(question !== undefined ? { question: question.trim() } : {}) };
}
