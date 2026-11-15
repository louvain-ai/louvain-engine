/**
 * The configuration a command runs, as the active profile's engine.config.ts says (the root's with none, `profile.ts`):
 * its plugins over the defaults, kind by kind, and its settings over the root's and the engine's, key by key. No file
 * runs the defaults; a file that throws stops the start at its line. Nothing here starts a plugin or opens a pool.
 */
import { join } from "node:path";
import { departures, type Settings, settingsOf } from "@louvain/engine";
import type { Plugins } from "@louvain/engine-core";
import { readConfig } from "./config-file.js";
import { defaults } from "./defaults.js";
import { over, type Profile, profileOf } from "./profile.js";

/**
 * The configuration, read, and its settings, which the engine it builds holds (`EngineParts.settings`), each at its default unless the file
 * states it; those that depart from their defaults are said once, on the error stream.
 */
export async function configuration(
  root = process.cwd(),
): Promise<{ plugins: Plugins; settings: Settings; profile: Profile }> {
  const profile = profileOf(root);
  const plugins = await readConfig(profile.config, defaults);
  const under =
    profile.name === null
      ? {}
      : (await readConfig(join(root, "engine.config.ts"), defaults)).settings;
  const settings = settingsOf(over(under, plugins.settings));
  const departed = departures(settings);
  if (departed.length > 0) console.error(`settings: ${departed.join(", ")}`);
  return { plugins, settings, profile };
}
