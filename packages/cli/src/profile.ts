/**
 * THE PROFILE A COMMAND RUNS: a folder under `profiles/` with its own engine.config.ts, chosen with
 * `./engine profile set <name>`, which remembers the name in `.engine/profile`; with none, the root's engine.config.ts
 * runs. A profile keeps its own state (its token, its secrets) in a folder named for it beside the install's, and the
 * wrapper gives it its own Compose project, so switching profile switches corpus and index together. Its settings go
 * over the root's, key by key.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { refuse } from "@louvain/engine-core";

/** Where a command's configuration and state are: the root's, or the profile's. */
export type Profile = {
  /** The profile's name, or null for the root's engine.config.ts. */
  name: string | null;
  /** The engine.config.ts it runs. */
  config: string;
  /** The directory its secrets and token live in. */
  state: string;
};

/** The profile `.engine/profile` names under `root`, or the root's own; a remembered profile with no folder is refused. */
export function profileOf(root: string): Profile {
  const name = remembered(join(root, ".engine", "profile"));
  if (name === null)
    return { name, config: join(root, "engine.config.ts"), state: join(root, ".engine") };
  const config = join(root, "profiles", name, "engine.config.ts");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !existsSync(config))
    refuse(
      `the profile "${name}" this install remembers has no profiles/${name}/engine.config.ts: ` +
        "./engine profile set default returns to the root's",
    );
  return { name, config, state: join(root, ".engine", "profiles", name) };
}

function remembered(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim() || null;
}

/** Settings written over others, leaf by leaf: a group the profile states keeps the root's other keys. */
export function over<T>(base: T, top: T): T {
  if (!plain(base) || !plain(top)) return top === undefined ? base : top;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(top)) merged[key] = over(merged[key], value);
  return merged as T;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
