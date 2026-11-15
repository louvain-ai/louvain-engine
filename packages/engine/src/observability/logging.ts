import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config/engine.js";
import { environment } from "../config/environment.js";
import { logDebugOn, logJsonOn } from "../config/log-switches.js";
import { scrubMessage } from "./scrub.js";

/**
 * Structured logging with request correlation: JSON lines, and a request id carried implicitly by `AsyncLocalStorage`,
 * so every line of a request (or a background task) joins up without threading a context through every function. Never
 * logged: message text, questions, passages, credentials. A log aggregator is a third party and a search index, so
 * `fields` takes primitives only, and logging an object full of indexed text takes effort rather than a spread.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

type RequestContext = { requestId: string; orgId?: string; route?: string };

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a correlation context every log line inside it will carry. */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

type Level = "debug" | "info" | "warn" | "error";

/**
 * Every line is scrubbed, as an exception is (`scrub.ts`): the message and every string field go through
 * `scrubMessage`, except the fields bounded by construction (a route template, a component or step name, an outcome, a
 * method, a status) and the correlation ids a line may carry. A log aggregator is a third party and a search index;
 * this is the net under the rule that indexed text is never written into a line.
 */
const BOUNDED = new Set([
  "route",
  "method",
  "status",
  "component",
  "step",
  "stage",
  "outcome",
  "reason",
  "kind",
  "connector",
  "provider",
  "queue",
  "level",
  "requestId",
  "orgId",
  "connectionId",
  "jobId",
  "worker",
  "process",
  "env",
  "release",
]);

function scrubbed(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return fields;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields))
    out[k] = typeof v === "string" && !BOUNDED.has(k) ? scrubMessage(v) : v;
  return out;
}

/**
 * The process group a deployment names (`LOUVAIN_PROCESS_GROUP`), which a log shipper reads into its `process` label.
 * Read when the first line is written, never at import: a deployment may set it in a module loaded after this one.
 */
let processGroup: string | null | undefined;
const processGroupNow = (): string | null => {
  if (processGroup === undefined) processGroup = environment("LOUVAIN_PROCESS_GROUP");
  return processGroup;
};

function emit(level: Level, raw: string, rawFields?: LogFields): void {
  const ctx = storage.getStore();
  const message = scrubMessage(raw);
  const fields = scrubbed(rawFields);
  const group = processGroupNow();
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    env: config.environment,
    release: config.release,
    worker: config.workerId,
    ...(group ? { process: group } : {}),
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.orgId ? { orgId: ctx.orgId } : {}),
    ...(ctx?.route ? { route: ctx.route } : {}),
    ...fields,
  };
  // Errors go to stderr: log shippers treat the streams differently, and an error on stdout pages nobody.
  const out = level === "error" ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

/**
 * In development, JSON lines are hostile to read. Pretty-print there and stay
 * structured everywhere else — the format is a property of the destination,
 * not of the code doing the logging.
 */
function pretty(level: Level, raw: string, rawFields?: LogFields): void {
  const ctx = storage.getStore();
  const message = scrubMessage(raw);
  const fields = scrubbed(rawFields);
  const id = ctx?.requestId ? ` [${ctx.requestId.slice(0, 8)}]` : "";
  const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  const out = level === "error" ? console.error : console.log;
  out(`${level.toUpperCase()}${id} ${message}${extra}`);
}

const structured = config.environment === "production" || logJsonOn();
const write = structured ? emit : pretty;

export const log = {
  debug: (message: string, fields?: LogFields) => {
    if (logDebugOn()) write("debug", message, fields);
  },
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

const said = new Set<string>();

/**
 * A warning said once a process, with its fix: a page goes on without what is missing, and the line would otherwise
 * repeat on every request. The line is a fixed sentence the caller writes, never data.
 */
export function sayOnce(line: string): void {
  if (said.has(line)) return;
  said.add(line);
  log.warn(line);
}
