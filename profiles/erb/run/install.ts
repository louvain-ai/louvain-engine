import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One of the install's settings as `./engine` reads it: the environment's value, else the line in the install's
 * `.env` (`NAME=value`, quotes optional), else nothing. A port or an address only; a key is never read from a file.
 */
export function installSetting(engineRoot: string, name: string): string | undefined {
  const named = process.env[name]?.trim();
  if (named) return named;
  const file = join(engineRoot, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && line.slice(0, at).trim() === name)
      return (
        line
          .slice(at + 1)
          .trim()
          .replace(/^"(.*)"$/, "$1") || undefined
      );
  }
  return undefined;
}
