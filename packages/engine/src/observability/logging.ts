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
const BOUNDED: ReadonlySet<string> = new Set([
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
 * The process group a deployment names (`LOUVAIN_PROCESS_GROUP`), which a log shipper reads into its `process` label:
 * `group`, asked when a line is written, never at import, since a deployment may set it in a module loaded after this.
 */
function emit(
  level: Level,
  raw: string,
  { fields: rawFields, group }: { fields: LogFields | undefined; group: string | null },
): void {
  const ctx = storage.getStore();
  const message = scrubMessage(raw);
  const fields = scrubbed(rawFields);
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
function pretty(level: Level, raw: string, rawFields: LogFields | undefined): void {
  const ctx = storage.getStore();
  const message = scrubMessage(raw);
  const fields = scrubbed(rawFields);
  const id = ctx?.requestId ? ` [${ctx.requestId.slice(0, 8)}]` : "";
  const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  const out = level === "error" ? console.error : console.log;
  out(`${level.toUpperCase()}${id} ${message}${extra}`);
}

const structured = config.environment === "production" || logJsonOn();

/** Lines, and a warning said once, with its fix: a fixed sentence the caller writes, never data. */
export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /**
   * A warning said once in this logger's life: a page goes on without what is missing, and the line would otherwise
   * repeat on every request.
   */
  sayOnce(line: string): void;
};

/** A logger over its process group (read when its first line is written) and the lines it has said once. */
function loggerOf(group: () => string | null, spoken: Set<string>): Logger {
  const write = (level: Level, message: string, fields?: LogFields) =>
    structured ? emit(level, message, { fields, group: group() }) : pretty(level, message, fields);
  const logger: Logger = {
    debug: (message, fields) => {
      if (logDebugOn()) write("debug", message, fields);
    },
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    sayOnce: (line) => {
      if (spoken.has(line)) return;
      spoken.add(line);
      logger.warn(line);
    },
  };
  return logger;
}

/** A logger of its own, as an engine is given one (`EngineParts.logger`, this unless given). */
export function openLogger(): Logger {
  let group: string | null | undefined;
  return loggerOf(() => {
    if (group === undefined) group = environment("LOUVAIN_PROCESS_GROUP");
    return group;
  }, new Set());
}

/**
 * The door's process group and say-once, for the call sites with no engine in reach (the engine-state check lists
 * them, and the list only shrinks); an engine's own logger is its part (`given.ts` `logOf`). Its say-once is `log.sayOnce`.
 */
let processGroup: string | null | undefined;
const said = new Set<string>();

/** The door: the process's lines. */
export const log: Logger = loggerOf(() => {
  if (processGroup === undefined) processGroup = environment("LOUVAIN_PROCESS_GROUP");
  return processGroup;
}, said);
