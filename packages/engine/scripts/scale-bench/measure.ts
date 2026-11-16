import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import type { Engine } from "../../src/index.js";

/** What the numbers were measured on, from this machine's own report. */
export function hardware(): string {
  const cores = cpus();
  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  return `${cores[0]?.model ?? "unknown CPU"}, ${cores.length} cores, ${Math.round(totalmem() / 2 ** 30)} GB, ${process.platform} ${release()}, Node ${process.version}, Docker ${docker || "unknown"}`;
}

const run = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // swallowed: a measurement this machine cannot take is reported as unknown, never as a number.
    return "";
  }
};

/** The install's containers, by service, from its Compose project's label. */
function containers(project: string): Map<string, string> {
  const rows = run("docker", [
    "ps",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    '{{.ID}} {{.Label "com.docker.compose.service"}}',
  ]);
  return new Map(
    rows
      .split("\n")
      .filter(Boolean)
      .map((r) => r.split(" "))
      .map(([id, s]) => [s ?? "", id ?? ""]),
  );
}

const MIB: Record<string, number> = {
  B: 2 ** -20,
  KiB: 2 ** -10,
  MiB: 1,
  GiB: 2 ** 10,
  kB: 1e3 / 2 ** 20,
  MB: 1e6 / 2 ** 20,
  GB: 1e9 / 2 ** 20,
};
const mib = (s: string) => {
  // case-ok: reads the unit docker stats prints after a figure
  const m = /([\d.]+)\s*([A-Za-z]+)/.exec(s);
  return m ? Number(m[1]) * (MIB[m[2] ?? ""] ?? 0) : 0;
};

/** Peak memory while `during` runs: this process's resident set and each service's, sampled every two seconds. */
export async function peaks<T>(
  project: string,
  during: () => Promise<T>,
): Promise<{ value: T; mib: Record<string, number> }> {
  const top: Record<string, number> = { engine: process.memoryUsage().rss / 2 ** 20 };
  const ids = containers(project);
  const sample = () =>
    new Promise<void>((done) => {
      top.engine = Math.max(top.engine ?? 0, process.memoryUsage().rss / 2 ** 20);
      if (ids.size === 0) return done();
      const p = spawn("docker", [
        "stats",
        "--no-stream",
        "--format",
        "{{.ID}} {{.MemUsage}}",
        ...ids.values(),
      ]);
      let out = "";
      p.stdout.on("data", (d) => {
        out += d;
      });
      p.on("close", () => {
        for (const [service, id] of ids)
          for (const line of out.split("\n"))
            if (id.startsWith(line.split(" ")[0] ?? "-") || line.startsWith(id.slice(0, 12)))
              top[service] = Math.max(top[service] ?? 0, mib(line.split(" ").slice(1).join(" ")));
        done();
      });
    });
  let going = true;
  const loop = (async () => {
    while (going) await Promise.all([sample(), new Promise((r) => setTimeout(r, 2_000))]); // timing: a sampling interval, asserts nothing
  })();
  try {
    return { value: await during(), mib: top };
  } finally {
    going = false;
    await loop;
  }
}

/** The database's size, and the workspace's keyword index on disk (its directory, `services/keyword-index/bm25_orgs.py`). */
export async function sizes(
  engine: Engine,
  project: string,
): Promise<{ postgres: number; keyword: number }> {
  const { sql } = engine.store;
  const [db] = await sql<
    { bytes: string }[]
  >`select pg_database_size(current_database())::text as bytes`;
  const [org] = await sql<{ id: string }[]>`select id::text from org limit 1`;
  const dir = createHash("sha256")
    .update(org?.id ?? "")
    .digest("hex")
    .slice(0, 32);
  const bm25 = containers(project).get("bm25");
  const du = bm25 ? run("docker", ["exec", bm25, "du", "-sb", `/index/orgs/${dir}`]) : "";
  return { postgres: Number(db?.bytes ?? 0), keyword: Number(du.split(/\s/)[0] || Number.NaN) };
}

/** The value at a percentile of the sorted samples (nearest rank). */
export function percentile(sorted: readonly number[], p: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
  );
}
