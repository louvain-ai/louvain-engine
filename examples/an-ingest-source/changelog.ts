/**
 * An ingest source in a dozen lines: every release in a Markdown changelog becomes one item, keyed by its version and
 * dated by its heading, so editing a release's notes updates that release and nothing else.
 *
 *   node --import tsx examples/an-ingest-source/changelog.ts CHANGELOG.md | ./engine ingest records --records - --collection changelog
 *
 * It is written against the engine's public contract and nothing else. Run as a script, it prints its items as JSON
 * Lines, which is what the records door reads, so the engine takes them unchanged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IngestSource } from "@louvain/engine-core";

/** A heading of a version and a day, `## <version> - <yyyy-mm-dd>`, then the release's notes until the next one. */
const RELEASE = /^## (\S+) - (\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;

export const changelog = (file: string): IngestSource => ({
  collection: "changelog",
  origin: file,
  lists: "all",
  complete: () => true,
  items: async function* () {
    for (const [, version, day, notes] of readFileSync(file, "utf8").matchAll(RELEASE))
      yield {
        key: `${version}`,
        title: `Release ${version}`,
        text: `${notes}`.trim(),
        date: `${day}T00:00:00Z`,
        precision: "day",
      };
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url))
  for await (const item of changelog(process.argv[2] ?? "CHANGELOG.md").items())
    console.log(JSON.stringify(item));
