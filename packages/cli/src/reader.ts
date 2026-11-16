/**
 * Readers, from the terminal: `./engine reader add <name>` makes a reader's token, `remove <name>` deletes it, and
 * `list` says who reads what: each reader, where its token is kept, and the collections engine.config.ts grants it. A
 * token is named by its file and never printed, as the engine's own is.
 */
import { join, relative } from "node:path";
import { addReader, EngineTokenRefused, readerFiles, removeReader } from "@louvain/engine";
import { DEFAULT_READER, PluginRefused } from "@louvain/engine-core";
import { configuration } from "./configuration.js";
import { stopOn, usage } from "./stop.js";

const USAGE = "usage: ./engine reader add <name> | remove <name> | list";
const [command, name, ...extra] = process.argv.slice(2);
const { plugins, profile } = await configuration().catch(stopOn(PluginRefused));
const granted = new Map(Object.entries(plugins.grants ?? {}));
const shown = (file: string): string => relative(process.cwd(), file);

try {
  if (command === "add" && name && extra.length === 0) add(name);
  else if (command === "remove" && name && extra.length === 0) remove(name);
  else if (command === "list" && name === undefined) list();
  else usage(USAGE);
} catch (err) {
  stopOn(EngineTokenRefused)(err);
}

function add(name: string): void {
  const file = shown(addReader(profile.state, name));
  console.log(
    `${name} reads with the token in ${file}: give it to ${name} as you would a password.`,
  );
  console.log(
    granted.get(name)?.length
      ? `It reads ${reads(name)}.`
      : `It reads nothing until engine.config.ts grants it a collection: grants: { "${name}": ["<collection>"] }`,
  );
}

function remove(name: string): void {
  if (!removeReader(profile.state, name))
    throw new EngineTokenRefused(`${name} has no token to remove`);
  console.log(`${name}'s token is removed: it reads nothing from the server's next start.`);
}

/** Every reader, its token's file and what it reads, one a line in columns. */
function list(): void {
  const files = new Map(readerFiles(profile.state).map((r) => [r.name, shown(r.file)]));
  const named = [...new Set([...files.keys(), ...granted.keys()])].sort();
  const rows = [
    [DEFAULT_READER, shown(join(profile.state, "token")), "every collection loaded"],
    ...named.map((n) => [n, files.get(n) ?? "(no token)", reads(n)]),
  ];
  const width = (i: number) => Math.max(...rows.map((row) => row[i]?.length ?? 0));
  for (const [who = "", file = "", what = ""] of rows)
    console.log(`${who.padEnd(width(0))}  ${file.padEnd(width(1))}  ${what}`);
}

/** The collections a reader is granted, or why it reads nothing. */
function reads(name: string): string {
  const collections = granted.get(name) ?? [];
  return collections.length > 0
    ? collections.join(", ")
    : "nothing: engine.config.ts grants it no collection";
}
