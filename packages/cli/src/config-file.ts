/**
 * engine.config.ts, read before anything starts. No file is not an error: the defaults run. A file that throws stops
 * the start at its line and never falls back to the defaults, which would run something the person did not write.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDefined, type Plugins, refuse, withDefaults } from "@louvain/engine-core";

export async function readConfig(path: string, defaults: Plugins): Promise<Plugins> {
  if (!existsSync(path)) return defaults;
  const loaded: { default?: unknown } = await import(pathToFileURL(path).href).catch(
    (err: unknown) => refuse(failedToLoad(path, err)),
  );
  if (!isDefined(loaded.default)) refuse(`${path} must export defineEngine({ … }) as its default`);
  return withDefaults(loaded.default, defaults);
}

function failedToLoad(path: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = err instanceof Error ? lineIn(err.stack ?? "", path) : undefined;
  return (
    `${line === undefined ? path : `${path}:${line}`} could not be loaded: ${message}. ` +
    "The engine does not start on its defaults in place of a configuration that failed"
  );
}

/** The line of the first stack frame inside the configuration file, as a path or a file URL names it. */
function lineIn(stack: string, path: string): number | undefined {
  const at = stack.split("\n").find((frame) => frame.includes(path));
  const line = at?.match(new RegExp(`${literal(path)}:(\\d+)`))?.[1];
  return line === undefined ? undefined : Number(line);
}

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
