import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A member is inflated only under the bounds (`ZIP_LIMITS`). `inflateEntry` and `checkedEntries` are private to
 * `zip-archive.ts`: every reader goes through `readZip`, `zipParts`, `boundedZip` or `checkedArchive`, which apply
 * them. So no other module may name either: a new reader that inflated a member itself could skip the bounds. A source
 * check, over every module under `src/`, the barrel and the reading surface included (they must not re-export them).
 */
const ALLOWED = new Set(["zip-archive.ts"]);
const RAW = /\b(inflateEntry|checkedEntries)\b/;

function sources(dir: URL): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(new URL(`${entry.name}/`, dir)).map((s) => ({
          ...s,
          file: `${entry.name}/${s.file}`,
        }))
      : entry.name.endsWith(".ts")
        ? [{ file: entry.name, text: readFileSync(new URL(entry.name, dir), "utf8") }]
        : [],
  );
}

test("only the archive names the raw inflate", () => {
  const all = sources(new URL("../src/", import.meta.url));
  assert.ok(
    all.some((s) => s.file === "zip-archive.ts"),
    "the archive module was found",
  );
  const naming = all.filter((s) => RAW.test(s.text)).map((s) => s.file);
  assert.deepEqual(
    naming.filter((file) => !ALLOWED.has(file)),
    [],
    "a module other than zip-archive.ts names inflateEntry or checkedEntries",
  );
});
