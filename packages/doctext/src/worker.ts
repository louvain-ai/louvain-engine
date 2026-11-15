/**
 * A reader that can be stopped, in a process of its own: a library's synchronous parse of hostile input cannot be
 * interrupted by a timer, and a thread's heap limit is no isolation (an out-of-memory inside a collection aborts the
 * whole process). So each read is a forked child with its own heap, an allowlisted environment (`worker-env.ts`),
 * its input and answer over IPC, killed with SIGKILL at its end and reaped, at most `MAX_READERS` at once.
 */
import { loaderFlags, readerEnv } from "./worker-env.js";
import {
  ReaderBusy,
  ReaderUnavailable,
  WorkerDeadline,
  WorkerFailed,
  WorkerOutOfMemory,
} from "./worker-errors.js";
import { type ReaderPool, SHARED_POOL, WORKER_HEAP_MB } from "./worker-pool.js";

/**
 * The fork failures that are the host's, not the file's; the first four pass, the rest are a broken deployment
 * (`ERR_MODULE_NOT_FOUND` is not a spawn code: it is read from the child's stderr, below).
 */
const SHORTAGE_CODES = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);
const SPAWN_CODES = new Set([...SHORTAGE_CODES, "ENOENT", "EACCES"]);
const unavailable = (code: string) => new ReaderUnavailable(SHORTAGE_CODES.has(code), code);

/** What a reader entry sends back. */
export type WorkerReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; unparsable?: boolean };

/** When a read must be answered, and in whose slots and heap it runs. */
export type WorkerRun = {
  /** Epoch ms. Past it a read still waiting for a slot is `ReaderBusy`; without `runMs`, it also ends the run. */
  deadline: number;
  heapMb?: number;
  /** Whose slots it takes: the shared pool unless the caller brings its own (`ReaderPool`). */
  pool?: ReaderPool;
  /** The run's own budget, from the moment a slot is taken, so a read that waited is never killed for its wait. */
  runMs?: number;
};

/**
 * Run `file` (a module that waits for one IPC message holding its input and sends back one `WorkerReply`) in a child
 * process, and wait for its answer. Past the run's end the child is killed (SIGKILL) and `WorkerDeadline` thrown; an
 * out-of-memory in it is `WorkerOutOfMemory`.
 */
export async function inWorker<T>(file: URL, input: unknown, run: WorkerRun): Promise<T> {
  const { fork } = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ "node:child_process"
  );
  const { fileURLToPath } = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ "node:url"
  );
  const { deadline, heapMb = WORKER_HEAP_MB, pool = SHARED_POOL, runMs } = run;
  if (deadline - Date.now() <= 0) throw new ReaderBusy();
  await pool.acquire(deadline);
  const ends = runMs === undefined ? deadline : Date.now() + runMs;
  try {
    return await new Promise<T>((resolve, reject) => {
      const child = fork(fileURLToPath(file), [], {
        execArgv: [...loaderFlags(process.execArgv), `--max-old-space-size=${heapMb}`],
        env: readerEnv(),
        serialization: "advanced",
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      watch<T>(child, { input, ends }, { resolve, reject });
    });
  } finally {
    pool.release();
  }
}

type Child = import("node:child_process").ChildProcess;
type Settle<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };
type Seen<T> = { reply?: WorkerReply<T>; failure?: unknown; stderr: string };

/**
 * One read's child, from its fork to its close. The read settles on `'close'`, never `'exit'`: it follows every
 * exit, an out-of-memory death, a SIGKILL and a fork that never started, after stderr and the IPC channel drain.
 */
function watch<T>(child: Child, read: { input: unknown; ends: number }, settle: Settle<T>): void {
  const clock: Clock = {};
  let done = false;
  const finish = (act: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(clock.timer);
    clearTimeout(clock.backstop);
    act();
  };
  // A fork that never started is the host's problem, never the file's: under EMFILE it has no IPC channel at all.
  if (typeof child.send !== "function") {
    child.once("error", () => {});
    finish(() => settle.reject(unavailable("EMFILE")));
    return;
  }
  const seen: Seen<T> = { stderr: "" };
  // V8's out-of-memory report arrives on stderr: kept (bounded) only to tell it from any other death.
  child.stderr?.on("data", (chunk: Buffer) => {
    if (seen.stderr.length < 8_192) seen.stderr += chunk.toString("utf8");
  });
  armDeadline(child, { seen, clock, ends: read.ends }, () =>
    finish(() => settle.reject(new WorkerDeadline())),
  );
  listen(child, seen);
  child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
    finish(() => {
      const outcome = closed(seen, code, signal);
      if (outcome.ok) settle.resolve(outcome.value);
      else settle.reject(outcome.error);
    }),
  );
  // Structured clone over IPC: bytes stay bytes. A fork with no pid never started: its 'error' arrives next.
  if (child.pid !== undefined)
    child.send(read.input as Parameters<typeof child.send>[0], (error) => {
      if (!error) return;
      seen.failure ??= error;
      child.kill("SIGKILL");
    });
}

type Clock = { timer?: ReturnType<typeof setTimeout>; backstop?: ReturnType<typeof setTimeout> };

/**
 * At the end the child is killed (a parse that ignores SIGTERM cannot ignore SIGKILL); the caller hears once it has
 * closed, or a second after the kill (`giveUp`) whatever the process table does.
 */
function armDeadline<T>(
  child: Child,
  state: { seen: Seen<T>; clock: Clock; ends: number },
  giveUp: () => void,
): void {
  state.clock.timer = setTimeout(
    () => {
      state.seen.failure = new WorkerDeadline();
      child.kill("SIGKILL");
      state.clock.backstop = setTimeout(giveUp, 1_000);
    },
    Math.max(0, state.ends - Date.now()),
  );
}

/** The child's answer, and a spawn failure, which is the host's (`ReaderUnavailable`) and kills what started. */
function listen<T>(child: Child, seen: Seen<T>): void {
  child.once("message", (message: WorkerReply<T>) => {
    seen.reply = message;
  });
  child.once("error", (error: Error & { code?: string }) => {
    seen.failure ??= SPAWN_CODES.has(error.code ?? "") ? unavailable(error.code ?? "") : error;
    child.kill("SIGKILL");
  });
}

/** What a closed child's read comes to: its answer, its own failure, the kill, or how it died. */
function closed<T>(
  seen: Seen<T>,
  code: number | null,
  signal: NodeJS.Signals | null,
): { ok: true; value: T } | { ok: false; error: unknown } {
  // An answer that arrived is the answer, even when the deadline fired while the child was exiting.
  if (seen.reply?.ok) return { ok: true, value: seen.reply.value };
  if (seen.reply)
    return { ok: false, error: new WorkerFailed(seen.reply.error, seen.reply.unparsable === true) };
  if (seen.failure) return { ok: false, error: seen.failure };
  if (signal === "SIGABRT" || /heap out of memory|Allocation failed/i.test(seen.stderr))
    return { ok: false, error: new WorkerOutOfMemory() };
  // The reader's own code would not load (a build without the entry, a missing dependency): the deployment's
  // fault, never the file's, so it uses up attempts and is reported.
  if (/ERR_MODULE_NOT_FOUND|Cannot find module/.test(seen.stderr))
    return { ok: false, error: unavailable("ERR_MODULE_NOT_FOUND") };
  return {
    ok: false,
    error: new WorkerFailed(`The reader stopped (${signal ?? `exit ${code}`})`, false),
  };
}

/** A sibling module of this one, as a reader process loads it: its `.ts` source under tsx (the tests), else the `.js`. */
export function siblingModule(name: string, base: string): URL {
  return new URL(`./${name}${base.endsWith(".ts") ? ".ts" : ".js"}`, base);
}

/**
 * A reader entry's side of the protocol: wait for the one input, compute, send the answer, exit. Every entry
 * (`calendar-worker.ts`, `email-worker.ts`, `subtitles-worker.ts`) is this plus its reader.
 */
export function serveReader<I, T>(
  read: (input: I) => Promise<T> | T,
  classify?: (error: unknown) => boolean,
): void {
  // First to go: `--max-old-space-size` does not cap a decoded attachment's buffers, so a reader's RSS can pass its
  // heap. When the kernel must kill something, it is a reader and never the service (Linux; raising one's own score
  // needs no privilege; anywhere else this does nothing).
  import("node:fs")
    .then((fs) => fs.writeFileSync("/proc/self/oom_score_adj", "1000"))
    .catch(() => {
      // swallowed: not Linux, or no /proc — the score is a preference, and the heap cap still holds.
    });
  process.once("message", async (input: I) => {
    let reply: WorkerReply<T>;
    try {
      reply = { ok: true, value: await read(input) };
    } catch (error) {
      reply = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(classify?.(error) ? { unparsable: true } : {}),
      };
    }
    process.send?.(reply, () => process.exit(0));
  });
}
