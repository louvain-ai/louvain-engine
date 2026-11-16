/**
 * Text from a folder is not trusted on the operator's terminal. A file's name is whatever its folder's author chose,
 * and a reader's refusal is whatever its plugin returned: a name holding a newline would forge a line of the loader's
 * report, and an escape sequence would reach the terminal itself. So every control character (C0, DEL and C1) is
 * written as a visible escape before anything from a folder is printed: `\n`, `\r`, `\t`, else `\xNN`.
 */
export function printable(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x20 && !(c >= 0x7f && c <= 0x9f)) out += ch;
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else out += `\\x${c.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** A count with its noun in the right number: "1 document", "4 documents". */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What a person calls each reason a file was not loaded; a reason with no entry here is shown as the reader wrote it. */
const SKIP_WORDS: Record<string, string> = {
  "no reader for this type": "unsupported type",
  "too-large": "too large",
  "too much text": "over the character limit (skipped whole, not cut)",
  link: "a link, not followed",
  "not a regular file": "not a regular file",
  empty: "empty",
};

/** Why one file was not loaded, in a person's words. */
export const skipWords = (why: string): string => printable(SKIP_WORDS[why] ?? why);

/** The skipped files as one line's tail: "1 unsupported type, 2 too large". */
export function skipSummary(skipped: Record<string, number>): string {
  return Object.entries(skipped)
    .map(([why, n]) => `${n} ${skipWords(why)}`)
    .join(", ");
}
