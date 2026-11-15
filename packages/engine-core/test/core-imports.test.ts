import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** The README names what the core imports outside itself (zod and one Node built-in); this holds it to that. */
const SRC = join(import.meta.dirname, "../src");
const ALLOWED = new Set(["zod", "node:crypto"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return files(join(dir, e.name));
    return e.name.endsWith(".ts") ? [join(dir, e.name)] : [];
  });
}

test("no source file of the core imports anything but itself, zod and node:crypto", () => {
  const stray: string[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^;'"]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? "";
      if (!spec.startsWith(".") && !ALLOWED.has(spec)) stray.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(stray, []);
});
