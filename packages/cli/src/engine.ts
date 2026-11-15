/**
 * The engine a command runs: its configuration (`configuration.ts`), built with `createEngine` from parts this process
 * opened and passed to it whole: the pool, the embedder made for its host (`embedderFor`), the started plugins, the
 * host its entry names over that pool, the settings. A plugin that will not start stops the start by name; the command
 * closes the engine when it is done. The reads and writes that embed ask the engine's own (`embedderOf`), never a
 * process binding.
 */
import {
  createEngine,
  databaseUrl,
  type Engine,
  type EngineParts,
  embedderFor,
  openStore,
  storeSettings,
} from "@louvain/engine";
import { createPluginRegistry } from "@louvain/engine-core";
import { configuration } from "./configuration.js";
import type { Profile } from "./profile.js";

/** The engine, and the profile it runs as: where its state is kept. */
export type Opened = Engine & { readonly profile: Profile };

/** The engine for this configuration, on the host the entry names (the open build's, which only an entry loads). */
export async function openEngine(
  hostOf: (sql: EngineParts["store"]["sql"]) => EngineParts["host"],
  root = process.cwd(),
): Promise<Opened> {
  const { plugins, settings, profile } = await configuration(root);
  const registry = await createPluginRegistry(plugins);
  // Opened once the plugins have started, so a start they refuse leaves no pool behind; nothing connects until a read.
  const store = openStore(databaseUrl(), storeSettings);
  const host = hostOf(store.sql);
  const engine = createEngine({
    store,
    embedder: embedderFor(host),
    plugins: registry,
    host,
    settings,
  });
  return Object.freeze({ ...engine, profile });
}
