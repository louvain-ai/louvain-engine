import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { writeRecords } from "./corpus/records.js";
import { EMBEDDER_ENV, embedderAnswers } from "./embedder.js";
import { BENCHMARK, SCORED_SEARCH } from "./scored.js";

/**
 * The steps that set a run up, each a command this install already has: fetch the benchmark into the profile's state
 * folder (never into the repository), write its corpus as one records file, start the engine as this profile, and
 * load the records. Each refuses rather than run on something other than what was scored. `profile` is the folder
 * `./engine profile set` runs (its engine.config.ts and state); `data` is the scored
 * profile's folder, whose `data/` every profile of this run reads.
 */
export type Place = { engineRoot: string; state: string; profile: string; data: string };

export function sh(
  command: string,
  args: readonly string[],
  o: { cwd: string; env?: NodeJS.ProcessEnv },
): void {
  const run = spawnSync(command, args, { cwd: o.cwd, stdio: "inherit", env: o.env ?? process.env });
  if (run.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${run.status ?? run.signal}`);
}

/** The evaluator at its commit, the corpus archive checked by its sha256, and the corpus as records. */
export async function prepare(p: Place, keepHeldOut: boolean): Promise<void> {
  const benchmark = join(p.state, "benchmark");
  mkdirSync(p.state, { recursive: true });
  if (!existsSync(benchmark))
    sh("git", ["clone", "--no-checkout", BENCHMARK.repository, benchmark], { cwd: p.state });
  sh("git", ["-c", "advice.detachedHead=false", "checkout", BENCHMARK.commit], { cwd: benchmark });
  const archive = join(p.state, "all_documents.zip");
  if (!existsSync(archive)) sh("curl", ["-fL", "-o", archive, BENCHMARK.corpus], { cwd: p.state });
  const sha = await sha256Of(archive);
  if (sha !== BENCHMARK.corpusSha256)
    throw new Error(`${archive} is not the scored corpus (sha256 ${sha})`);
  const corpus = join(p.state, "corpus");
  if (!existsSync(corpus)) sh("unzip", ["-q", archive, "-d", corpus], { cwd: p.state });
  const heldOut = keepHeldOut ? new Set<string>() : heldOutOf(p.data);
  const count = await writeRecords(corpus, join(p.state, "records.jsonl"), heldOut);
  console.log(
    `${count.documents} documents as ${count.items} items; ${count.heldOut} held out, as the scored index held them`,
  );
  console.log(`not carried by the engine's item: ${JSON.stringify(count.notCarried)}`);
}

/** `./engine up` as this profile: its engine.config.ts, its own state and stack, and the one setting still in the environment. */
export function up(p: Place): void {
  sh("./engine", ["profile", "set", basename(p.profile)], { cwd: p.engineRoot });
  sh("./engine", ["up"], { cwd: p.engineRoot, env: runEnv() });
}

/** What every `./engine` step of the run carries: the scored search setting and the tuned embedder's conventions. */
const runEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ...SCORED_SEARCH, ...EMBEDDER_ENV });

/**
 * `./engine ingest records --records`: each record's keyword entry is written as it loads, so no reindex follows. It
 * refuses to start unless the embedding service is the tuned embedder: an index made with another is another system.
 */
export async function load(p: Place): Promise<void> {
  const records = join(p.state, "records.jsonl");
  if (!existsSync(records))
    throw new Error(`${records} does not exist: run the prepare step first`);
  await embedderAnswers(p, AbortSignal.timeout(30_000));
  sh("./engine", ["ingest", "records", "--records", records, "--collection", "benchmark"], {
    cwd: p.engineRoot,
    env: runEnv(),
  });
}

/** The documents the scored build's screening held out of search: `data/held-out.txt`, a dsid a line. */
function heldOutOf(profile: string): Set<string> {
  const rows = readFileSync(join(profile, "data/held-out.txt"), "utf8").split("\n");
  return new Set(rows.map((row) => row.trim()).filter((dsid) => dsid.startsWith("dsid_")));
}

function sha256Of(path: string): Promise<string> {
  return new Promise((done, failed) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done(hash.digest("hex")))
      .on("error", failed);
  });
}
