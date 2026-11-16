/**
 * The engine at scale: how fast it loads, how fast it searches, how much disk and memory it takes, at 10,000, 100,000
 * and 1,000,000 passages of a made-up corpus (`scale-bench/corpus.ts`). Run from an install's folder, with its stack up:
 *
 *   ./engine up && node --import tsx packages/engine/scripts/scale-bench.ts [--scales 10000,100000,1000000]
 *     [--embed-up-to 10000] [--targets 50] [--seed 7]
 *
 * Each scale loads its corpus into a database of its own (made from the baseline schema, so its own workspace and its
 * own keyword index) through the records source and the engine's one ingest (`ingestFrom`), then runs every query
 * through the search tool (`openSearch`), one at a time, in this process, after a warm-up, with `analyze` run first.
 * The default configuration: no reranker, no answerer, the open embedder in the install's Compose stack, on this
 * machine's CPU. A scale above `--embed-up-to` embeds with a stand-in (`stack.ts`) and is searched by keyword only, and
 * its row says so. A failed check stops the run; the rows of the scales before it are already printed. Nothing is paid
 * for and nothing leaves the machine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { type Engine, ingestFrom, openSearch, openSource } from "../src/index.js";
import { type Query, queriesOf, targetsOf, writeCorpus } from "./scale-bench/corpus.js";
import { hardware, peaks, percentile, sizes } from "./scale-bench/measure.js";
import { freshDatabase, openBenchEngine, useInstall } from "./scale-bench/stack.js";

const { values } = parseArgs({
  options: {
    scales: { type: "string", default: "10000,100000,1000000" },
    "embed-up-to": { type: "string", default: "10000" },
    targets: { type: "string", default: "50" },
    seed: { type: "string", default: "7" },
  },
});
const ROOT = process.cwd();
const PROJECT =
  process.env.COMPOSE_PROJECT_NAME ??
  basename(ROOT)
    .toLowerCase()
    // case-ok: the Compose project name, a slug after lower-casing
    .replace(/[^a-z0-9_-]/g, "");
const SEED = Number(values.seed);
const COLLECTION = "bench";
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`scale-bench: ${what}`);
};

/** Load `count` records; the wall time, the summary and the peaks. Progress every 10,000 records. */
async function load(engine: Engine, file: string, count: number) {
  const source = openSource(engine.plugins, "records", { records: file, collection: COLLECTION });
  const started = performance.now();
  let seen = 0;
  const { value: summary, mib } = await peaks(PROJECT, () =>
    ingestFrom(engine.writes, source, {
      source: "records",
      files: null,
      lane: null,
      removals: "keep",
      takeOver: false,
      removeMany: false,
      onItem: () => {
        if (++seen % 10_000 === 0)
          console.log(
            `  ${seen} records, ${Math.round(seen / ((performance.now() - started) / 1000))}/s`,
          );
      },
    }),
  );
  return { seconds: (performance.now() - started) / 1000, summary, mib };
}

/** What the load left: passages, passages without a vector, and statistics refreshed for the planner. */
async function settled(engine: Engine) {
  const { sql } = engine.store;
  await sql`analyze`;
  const [row] = await sql<{ passages: number; unembedded: number }[]>`
    select count(*)::int as passages, count(*) filter (where embedding is null)::int as unembedded from passage`;
  return { passages: row?.passages ?? 0, unembedded: row?.unembedded ?? 0 };
}

type Mode = "hybrid" | "keyword";

/** Each query once, in `mode`, after a warm-up of ten: latencies by kind, and how many found their target. */
async function searched(engine: Engine, queries: readonly Query[], mode: Mode) {
  const search = openSearch(engine);
  const ask = (q: Query) => search({ query: q.query, ...(mode === "keyword" ? { mode } : {}) });
  for (const q of queries.slice(0, 10)) await ask(q);
  const by: Record<string, { ms: number[]; found: number }> = {};
  for (const q of queries) {
    const t = performance.now();
    const page = (await ask(q)) as { sources?: { title: string }[]; degraded?: string[] };
    const ms = performance.now() - t;
    check(
      !page.degraded?.length,
      `a ${mode} search came back degraded (${page.degraded?.join(", ")})`,
    );
    const slot = by[q.kind] ?? { ms: [], found: 0 };
    by[q.kind] = slot;
    slot.ms.push(ms);
    if (page.sources?.some((s) => s.title === q.target)) slot.found += 1;
  }
  return Object.entries(by).map(([kind, { ms, found }]) => {
    const sorted = ms.sort((a, b) => a - b);
    return {
      mode,
      kind,
      n: ms.length,
      found,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    };
  });
}

/** Every query in each mode the scale's vectors allow, with the peak memory while they ran. */
function searchedAll(engine: Engine, queries: readonly Query[], embedding: "real" | "stand-in") {
  const modes: Mode[] = embedding === "real" ? ["hybrid", "keyword"] : ["keyword"];
  return peaks(PROJECT, async () => {
    const rows = [];
    for (const m of modes) rows.push(...(await searched(engine, queries, m)));
    return rows;
  });
}

/** One scale, whole: its row, printed as soon as it is measured. */
async function scale(count: number, server: string, embedUpTo: number) {
  const embedding = count <= embedUpTo ? "real" : "stand-in";
  await freshDatabase(ROOT, server, `scale_bench_${count}`);
  const engine = await openBenchEngine(embedding);
  const dir = mkdtempSync(join(tmpdir(), "scale-bench-"));
  try {
    const file = join(dir, "corpus.jsonl");
    const targets = await writeCorpus(file, {
      seed: SEED,
      count,
      targets: targetsOf(SEED, count, Number(values.targets)),
    });
    console.log(
      `scale ${count}: loading (${embedding === "real" ? "embedded" : "stand-in vectors"})`,
    );
    const loaded = await load(engine, file, count);
    check(
      loaded.summary.keyword.missed === 0,
      `${loaded.summary.keyword.missed} keyword entries missed`,
    );
    const left = await settled(engine);
    check(left.unembedded === 0, `${left.unembedded} passages have no vector`);
    const { value: latency, mib } = await searchedAll(engine, queriesOf(targets), embedding);
    const row = {
      count,
      embedding,
      ...left,
      loadSeconds: loaded.seconds,
      perSecond: count / loaded.seconds,
      size: await sizes(engine, PROJECT),
      memory: { load: loaded.mib, search: mib },
      latency,
    };
    console.log(`RESULT ${JSON.stringify(row)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await engine.close();
  }
}

console.log(`scale-bench on ${hardware()}; compose project ${PROJECT}; seed ${SEED}`);
const { server } = useInstall(ROOT);
for (const count of values.scales.split(",").map(Number))
  await scale(count, server, Number(values["embed-up-to"]));
