import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The statements a read sends, as text. Captured with the driver's `debug` hook, which hears every statement on every
 * connection with its parameters; transaction control and the driver's own catalogue lookups are dropped, and a
 * `set local` is kept as a statement of its own, since it changes the plan of what follows it.
 *
 * Two texts. A statement is compared by its NORMALISED text: each run of whitespace outside a string literal or a
 * comment becomes one space, and a `--` comment keeps its line end, so a template re-indented passes and one whose
 * words change fails. The RAW text is what the snapshot shows and what a re-indent changes; a difference only there is
 * reported, not failed.
 */
export type Sent = { text: string; parameters: number; preamble: string; values: unknown[] };

type Debug = (connection: number, text: string, values: unknown[]) => void;
type Driver = { options: { debug: Debug | false } };

const CONTROL = /^\s*(begin|commit|rollback|savepoint|release)\b/i;
const CATALOGUE = /from pg_catalog\.pg_type\b/;

/** Run `work` and return every statement it sent, each with the `set local` settings in force on its connection. */
export async function capture(sql: unknown, work: () => Promise<unknown>): Promise<Sent[]> {
  const driver = sql as Driver;
  const sent: Sent[] = [];
  const settings = new Map<number, string[]>();
  driver.options.debug = (connection, text, values) => {
    if (CONTROL.test(text)) settings.delete(connection);
    if (CONTROL.test(text) || CATALOGUE.test(text)) return;
    const preamble = (settings.get(connection) ?? []).join("; ");
    if (/^\s*set local\b/i.test(text))
      settings.set(connection, [...(settings.get(connection) ?? []), text]);
    sent.push({ text, parameters: values.length, preamble, values });
  };
  try {
    await work();
  } finally {
    driver.options.debug = false;
  }
  return sent;
}

/** Whitespace folded outside literals; a comment ends its line. */
export function normalised(text: string): string {
  const pieces = text.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\s+|[^'"\s-]+|-/g) ?? [];
  return pieces
    .map((p) => (/^\s+$/.test(p) ? " " : p.startsWith("--") ? `${p.trimEnd()}\n` : p))
    .join("")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/** A fenced read: one whose WHERE names the reader's collections in any of the fence's spellings. */
export const fenced = (text: string) =>
  /container\s+(?:in\s*\(\s*select\s+unnest|=\s*any\s*\()|\breadable_container\b|\bfrom readable\b/i.test(
    text,
  );

const SOURCE_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));

function sourceFiles(dir = SOURCE_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

/** A source file with its whitespace folded, and where each of its lines starts in the folded text. */
type Source = { file: string; lines: string[]; folded: string; starts: number[] };

let sources: Source[] | undefined;

function readSource(file: string): Source {
  const lines = readFileSync(file, "utf8").split("\n");
  const starts: number[] = [];
  let folded = "";
  for (const line of lines) {
    starts.push(folded.length);
    folded += `${line.trim()} `;
  }
  return { file, lines, folded, starts };
}

/**
 * Where a statement comes from, found by its text. The statement is cut into stretches between its values (a parameter
 * or a quoted name). From the opening stretch on, the engine source files holding each stretch narrow the candidates
 * until one is left (a stretch none of them holds is a fragment from elsewhere); failing that, the first stretch only
 * one file holds decides. The sender is the function around the opening stretch in that file. For a reader of the
 * snapshot only: nothing is compared on it, so a statement moved to another file is the same statement.
 */
export function senderOf(text: string): string {
  if (/^\s*set local\b/i.test(text)) return "settings";
  sources ??= sourceFiles().map(readSource);
  const all = sources;
  const holders = text
    .replace(/\s+/g, " ")
    .split(/\$\d+|"[^"]*"/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)
    .map((stretch) => ({ stretch, files: all.filter((s) => s.folded.includes(stretch)) }));
  let candidates = all;
  for (const { files } of holders) {
    const narrower = candidates.filter((c) => files.includes(c));
    if (narrower.length > 0) candidates = narrower;
    if (candidates.length === 1) break;
  }
  const several = candidates;
  if (candidates.length > 1) candidates = holders.find((h) => h.files.length === 1)?.files ?? [];
  const [only] = candidates;
  const opening = holders.find((h) => only && h.files.includes(only))?.stretch;
  // The same text in more than one file: named for all of them.
  if (!only || !opening)
    return several.length > 1 && several.length < 4
      ? several.map((s) => basename(s.file, ".ts")).join("+")
      : "unattributed";
  const line = only.starts.findLastIndex((start) => start <= only.folded.indexOf(opening));
  return `${basename(only.file, ".ts")}.${functionAround(only.lines, line)}`;
}

function functionAround(lines: string[], at: number): string {
  for (let i = at; i >= 0; i--) {
    const m = /^(?:export )?(?:async )?function\*? (\w+)|^(?:export )?const (\w+) =/.exec(
      lines[i] ?? "",
    );
    if (m) return m[1] ?? m[2] ?? "module";
  }
  return "module";
}
