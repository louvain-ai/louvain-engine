import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The keyword index the database tests read, as the open build requires one, ONE PER TEST FILE: the index's ranking
 * statistics are its whole content's, so an index another file's corpus shares would move this file's recorded order.
 * Where no Python has its binding, a container of an image built from `apps/nlp/Dockerfile.bm25`
 * (`LOUVAIN_TEST_BM25_IMAGE`); else a Python with its binding (`LOUVAIN_TEST_BM25_PYTHON`, else `apps/nlp/.venv` in this
 * checkout or one above). Either runs with
 * the analyzer on, as the open build's compose starts it. `LOUVAIN_TEST_BM25_URL` names one already running instead,
 * for a single file.
 */
const here = dirname(fileURLToPath(import.meta.url));
// Read at import, before a harness clears every `LOUVAIN_` setting (`engine.ts` `settings`).
const NAMED = process.env.LOUVAIN_TEST_BM25_URL;
const PYTHON = process.env.LOUVAIN_TEST_BM25_PYTHON;
const IMAGE = process.env.LOUVAIN_TEST_BM25_IMAGE;

export type Index = { url: string; stop: () => void };

const NONE =
  "no keyword index for the database tests: set LOUVAIN_TEST_BM25_IMAGE=$(docker build -q -f apps/nlp/Dockerfile.bm25 .) " +
  "from the repository root (or LOUVAIN_TEST_BM25_URL, or a Python with its binding: LOUVAIN_TEST_BM25_PYTHON, apps/nlp/.venv)";

/** Why this run can start no keyword index, or undefined when it can (a URL, an image or a Python). */
export const noKeywordIndex = (): string | undefined =>
  NAMED || IMAGE || python() ? undefined : NONE;

/** The run's keyword index, or a reason there is none (the caller skips or fails with it). */
export async function keywordIndexForTests(): Promise<Index | string> {
  if (NAMED) return { url: NAMED, stop: () => {} };
  if (IMAGE) return startContainer(IMAGE);
  const py = python();
  if (!py) return NONE;
  return startIndex(py);
}

/** A Python that can run the keyword index, or none. */
export function python(): string | undefined {
  if (PYTHON) return PYTHON;
  for (let dir = here; dir !== dirname(dir); dir = dirname(dir)) {
    const venv = join(dir, "apps", "nlp", ".venv", "bin", "python");
    if (existsSync(venv)) return venv;
  }
  return undefined;
}

export const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** The keyword index on a port and in a directory of its own. */
export async function startIndex(py: string): Promise<{ url: string; stop: () => void }> {
  let root = here;
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) root = dirname(root);
  const dir = mkdtempSync(join(tmpdir(), "keyword-index-"));
  const port = await freePort();
  // With the analyzer on, as the open build's compose starts it, so the table measures what the open build runs.
  const env = {
    PATH: process.env.PATH,
    PORT: String(port),
    LOUVAIN_BM25_DIR: dir,
    LOUVAIN_BM25_ANALYZER: "on",
  };
  const child: ChildProcess = spawn(py, [join(root, "apps", "nlp", "bm25.py")], {
    env,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  for (let tries = 0; tries < 300; tries++) {
    const up = await fetch(`${url}/healthz`).then(
      (r) => r.ok,
      () => false,
    );
    if (up)
      return {
        url,
        stop: () => {
          child.kill();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    await new Promise((r) => setTimeout(r, 100)); // timing: a readiness poll of a child process; it asserts nothing
  }
  child.kill();
  throw new Error("the keyword index never answered");
}

/** The index as a container of `image`, on a loopback port of its own, removed when stopped. */
async function startContainer(image: string): Promise<Index> {
  const run = spawnSync(
    "docker",
    ["run", "-d", "--rm", "-e", "LOUVAIN_BM25_ANALYZER=on", "-p", "127.0.0.1::8095", image],
    { encoding: "utf8" },
  );
  const id = run.stdout.trim();
  if (run.status !== 0 || !id)
    throw new Error(`the keyword index container did not start: ${run.stderr}`);
  const stop = () => {
    spawnSync("docker", ["stop", id]);
  };
  const port = spawnSync("docker", ["port", id, "8095/tcp"], { encoding: "utf8" })
    .stdout.split(":")
    .at(-1)
    ?.trim();
  const url = `http://127.0.0.1:${port}`;
  for (let tries = 0; tries < 300; tries++) {
    if (
      await fetch(`${url}/healthz`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return { url, stop };
    await new Promise((r) => setTimeout(r, 100)); // timing: a readiness poll of a container; it asserts nothing
  }
  stop();
  throw new Error("the keyword index container never answered");
}
