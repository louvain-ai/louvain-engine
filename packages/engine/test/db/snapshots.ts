import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalised, type Sent } from "./statements.js";

/**
 * One file a statement. A snapshot is a header of `--` lines, an empty line, and the statement's raw text exactly as
 * it was sent. The header names where the text was found in the source (for a reader), how many parameters it takes,
 * the `set local` settings it runs under, which cases send it, and the shape of its plan on the corpus.
 *
 * A statement is compared by its normalised text, its parameter count and its settings: the same text under other
 * settings is another statement, since the settings choose its plan. The comparison is one set across every case.
 */
export type Snapshot = {
  file: string;
  sender: string;
  raw: string;
  parameters: number;
  /** The `set local` statements in force when it was sent, joined; empty outside a transaction that sets any. */
  settings: string;
  readBy: string[];
  /** Node types from the top of the plan down, without costs or counts; null for a setting. */
  plan: string | null;
  postgres: number;
};

export const keyOf = (s: Pick<Snapshot, "raw" | "parameters" | "settings">) =>
  `${s.parameters}|${normalised(s.settings)}|${normalised(s.raw)}`;

const header = (s: Snapshot) =>
  [
    `-- ${s.sender}, found by its text`,
    `-- parameters: ${s.parameters}`,
    ...(s.settings ? [`-- under: ${s.settings.replace(/\s+/g, " ")}`] : []),
    `-- read by: ${s.readBy.join("; ")}`,
    ...(s.plan ? [`-- plan on Postgres ${s.postgres}: ${s.plan}`] : []),
  ].join("\n");

const field = (head: string, name: string) =>
  new RegExp(`^-- ${name}: (.*)$`, "m").exec(head)?.[1] ?? "";

export function readSnapshots(dir: URL): Snapshot[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  } catch {
    return [];
  }
  return files.sort().map((file) => {
    const text = readFileSync(new URL(file, dir), "utf8");
    const split = text.indexOf("\n\n");
    const head = text.slice(0, split);
    const plan = /^-- plan on Postgres (\d+): (.*)$/m.exec(head);
    return {
      file,
      sender: /^-- (\S+), found by its text$/m.exec(head)?.[1] ?? "",
      raw: text.slice(split + 2, -1),
      parameters: Number(field(head, "parameters")),
      settings: field(head, "under"),
      readBy: field(head, "read by").split("; ").filter(Boolean),
      plan: plan?.[2] ?? null,
      postgres: Number(plan?.[1] ?? 0),
    };
  });
}

/** Replace every snapshot with these; returns one line a statement saying what changed. */
export function writeSnapshots(dir: URL, was: Snapshot[], now: Snapshot[]): string[] {
  const path = dir.pathname;
  mkdirSync(path, { recursive: true });
  for (const old of was) rmSync(join(path, old.file));
  for (const s of now) writeFileSync(join(path, s.file), `${header(s)}\n\n${s.raw}\n`);
  const before = new Map(was.map((s) => [keyOf(s), s]));
  const after = new Set(now.map(keyOf));
  return [
    ...now.map((s) => {
      const old = before.get(keyOf(s));
      if (!old) return `+ ${s.file}`;
      return old.raw === s.raw && old.plan === s.plan ? `= ${s.file}` : `~ ${s.file}: raw or plan`;
    }),
    ...was.filter((s) => !after.has(keyOf(s))).map((s) => `- ${s.file}`),
  ];
}

/**
 * The distinct statements of every case, in a stable order, each named for its sender and paired with one sending of
 * it (its values and settings), from which its plan is read. A statement's cases are listed in the order they ran.
 */
export function distinctStatements(
  heard: { name: string; sent: Sent[] }[],
  senderOf: (text: string) => string,
): { snapshot: Snapshot; sample: Sent }[] {
  const byKey = new Map<string, { snapshot: Snapshot; sample: Sent }>();
  for (const { name, sent } of heard)
    for (const s of sent) {
      const statement = { raw: s.text, parameters: s.parameters, settings: s.preamble };
      const known = byKey.get(keyOf(statement))?.snapshot;
      if (known && !known.readBy.includes(name)) known.readBy.push(name);
      if (known) continue;
      const snapshot = { ...statement, file: "", sender: senderOf(s.text), readBy: [name] };
      byKey.set(keyOf(statement), {
        snapshot: { ...snapshot, plan: null, postgres: 0 },
        sample: s,
      });
    }
  const order = (a: Snapshot) => `${a.sender} ${keyOf(a)}`;
  const all = [...byKey.values()].sort((a, b) => (order(a.snapshot) < order(b.snapshot) ? -1 : 1));
  const count = new Map<string, number>();
  for (const { snapshot } of all) {
    const n = (count.get(snapshot.sender) ?? 0) + 1;
    count.set(snapshot.sender, n);
    snapshot.file = `${snapshot.sender}.${n}.sql`;
  }
  return all;
}
