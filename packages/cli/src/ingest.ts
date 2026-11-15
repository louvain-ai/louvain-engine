/**
 * `./engine ingest <source> --<field> <value> …` runs a source the configuration names, its request's fields given as
 * flags (`request-flags.ts`): `./engine ingest folder --folder ./docs` keeps a collection in step with a folder,
 * `./engine ingest records --records items.jsonl` loads one item a line. Every source goes through the engine's one
 * ingest, which says what changed, and files are read by the configuration's readers.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { parseArgs } from "node:util";
import type { Engine } from "@louvain/engine";
import {
  fileReaderLane,
  IngestRefused,
  IngestSourceRefused,
  ingestFrom,
  itemLine,
  OriginRefused,
  openHost,
  openSource,
  printable,
  sourceNamed,
  summaryLines,
} from "@louvain/engine";
import { PluginRefused, type PluginRegistry } from "@louvain/engine-core";
import { z } from "zod";
import { openEngine } from "./engine.js";
import { type Field, fieldsOf, helpOf, optionsOf, requestOf } from "./request-flags.js";
import { stopOn, usage } from "./stop.js";

/** The run's own flags, beside the source's and read by the same rule: what a run may remove, and where files are read. */
const Run = z.object({
  keep: z.boolean().optional().describe("remove nothing the source no longer lists"),
  yes: z.boolean().optional().describe("remove even when most of the collection would go"),
  "take-over": z.boolean().optional().describe("take over a collection another source feeds"),
  files: z.string().optional().describe("the folder files the items name may be read under"),
  help: z.boolean().optional().describe("these lines"),
});
const RUN = fieldsOf(Run);

const usageOf = (plugins: PluginRegistry) =>
  "usage: ./engine ingest <source> [--<field> <value> …] [--keep] [--yes] [--take-over] [--files <folder>]\n" +
  `       ./engine ingest <source> --help lists its fields; engine.config.ts runs: ${plugins
    .list("source")
    .map((s) => s.name)
    .join(", ")}`;

const [name, ...argv] = process.argv.slice(2);
const engine = await openEngine(openHost).catch(stopOn(PluginRefused));
if (name === undefined || name.startsWith("-")) usage(usageOf(engine.plugins));
await ingest(engine, name, argv)
  .catch(refused)
  .finally(() => engine.close());

async function ingest(engine: Engine, name: string, argv: string[]): Promise<void> {
  const { plugins } = engine;
  const fields = fieldsOf(sourceNamed(plugins, name).request);
  const values = flags(name, fields, argv);
  const run = Run.parse(requestOf(RUN, values));
  const source = openSource(plugins, name, requestOf(fields, values));
  if (run.files !== undefined && source.files !== undefined)
    throw new IngestSourceRefused(
      `--files: the "${name}" source reads its files under ${shown(source.files)}, which its request named`,
    );
  console.log(
    `ingesting ${printable(shown(source.origin))} into "${printable(source.collection)}"`,
  );
  const summary = await ingestFrom(engine.writes, source, {
    source: name,
    files: filesFolder(source.files ?? run.files),
    lane: fileReaderLane(plugins),
    removals: run.keep ? "keep" : "sync",
    takeOver: run["take-over"] === true,
    removeMany: run.yes === true,
    onItem: (outcome) => {
      const line = itemLine(outcome);
      if (line) console.log(line);
    },
  });
  console.log(summaryLines(summary).join("\n"));
  if (summary.keyword.missed > 0) process.exitCode = 1;
}

/** The flags, by `node:util`'s `parseArgs`: the run's and the source's fields; `--help` prints both and exits. */
function flags(name: string, fields: readonly Field[], argv: string[]) {
  const taken = fields.find((f) => RUN.some((run) => run.name === f.name));
  if (taken)
    throw new IngestSourceRefused(
      `the "${name}" source's request has a field "${taken.name}", a flag the run keeps for itself`,
    );
  const help = [`usage: ./engine ingest ${name} [flags]`, ...helpOf([...fields, ...RUN])].join(
    "\n",
  );
  try {
    const { values } = parseArgs({ args: argv, options: optionsOf([...fields, ...RUN]) });
    if (values.help) {
      console.log(help);
      process.exit(0);
    }
    return values;
  } catch (err) {
    // swallowed: flags it cannot parse are said with the source's fields, and the command exits 2.
    return usage(`${err instanceof Error ? err.message : String(err)}\n${help}`);
  }
}

/** What a source reads, as the person sees it from where they ran the command: a path relative to here. */
function shown(origin: string): string {
  return isAbsolute(origin) ? relative(realpathSync(process.cwd()), origin) || "." : origin;
}

/** The real path of the folder files may be read under, or null for none. */
function filesFolder(path: string | undefined): string | null {
  if (path === undefined) return null;
  try {
    return realpathSync(path);
  } catch {
    // swallowed: refused by name, before anything is read.
    throw new IngestSourceRefused(`--files: ${path} is not a folder that exists`);
  }
}

/** A refusal is the person's to act on: said, with what to do for a collection another source feeds. */
function refused(err: unknown): void {
  if (!(err instanceof IngestRefused || err instanceof IngestSourceRefused)) throw err;
  console.error(`engine: ${err.message}`);
  if (err instanceof OriginRefused)
    console.error(
      "Name another collection with --collection, or take this one over with --take-over.",
    );
  process.exitCode = 2;
}
