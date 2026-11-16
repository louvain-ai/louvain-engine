/**
 * The engine's own settings: the database and its pool, how held records are read, and the process's name in logs,
 * each read through its declaration (`settings.ts`); beside them, two fixed ways of writing that tests flip on `config`.
 *
 * `config` is read once, at import, and is the one object every reader shares: an application built on the engine
 * defines its own settings onto this object rather than copying it, so a value assigned through either is the value
 * both see.
 */
import type { openStore } from "../store/pool.js";
import { environment } from "./environment.js";

/**
 * Two ways of writing that are the engine's, not a deployment's: each is on, and a test turns one off on `config` to
 * hold the other path to the same index.
 */
const BM25_GROUP_COMMIT = true;
const PASSAGE_WRITE_ONCE = true;

/** The database. */
const databaseSettings = () => ({
  databaseUrl: environment("DATABASE_URL"),
  /** Protocol-level prepared statements: off for a transaction pooler that may move statements between backends. */
  dbPrepare: environment("LOUVAIN_DB_PREPARE"),
  /**
   * How a prepared statement is planned: `force_custom_plan` (default), `auto`, `force_generic_plan`, or `off` to leave
   * it to the server. Where it applies is `dbPlanCacheScope` (`store/plan-cache.ts`); nowhere without prepared statements.
   */
  dbPlanCacheMode: environment("LOUVAIN_DB_PLAN_CACHE_MODE"),
  /**
   * `reads` (default): set inside bounded reads only. `connection`: sent at connect as well, on an endpoint that cannot
   * be a pooler, at the cost of a plan per execution for every statement (`store/plan-cache.ts`).
   */
  dbPlanCacheScope: environment("LOUVAIN_DB_PLAN_CACHE_SCOPE"),
  /**
   * `off` (default): the app's connections never JIT-compile — `jit = off` at connect on a direct endpoint, and on a
   * pooled one the boot log names the `ALTER ROLE` that does it. `server`: leave it to the server (`store/jit.ts`).
   */
  dbJit: environment("LOUVAIN_DB_JIT"),
  dbPoolMax: environment("LOUVAIN_DB_POOL_MAX"),
});

/** The process, as logs and errors name it. */
const processSettings = () => ({
  /** Tags every log line, so one deployment's noise never reads as another's. */
  environment:
    environment("LOUVAIN_ENVIRONMENT") ??
    (environment("NODE_ENV") === "production" ? "production" : "development"),
  /** Release identifier, for attributing a regression to a deploy. */
  release: environment("LOUVAIN_RELEASE"),
  /** Names this process on every log line, so a stuck one is found. */
  workerId:
    environment("LOUVAIN_WORKER_ID") ?? `${process.pid}@${environment("HOSTNAME") ?? "local"}`,
  /** Concurrent keyword writes share one sidecar commit (`store/keyword-index.ts`): fewer commits for the same index. */
  bm25GroupCommit: BM25_GROUP_COMMIT,
  /** A new record's passages are written once, each with its header context (`ingest/index-record.ts`). */
  passageWriteOnce: PASSAGE_WRITE_ONCE,
  /**
   * A record held as instruction-like stays searchable and citable, labelled wherever its passages go so a reader
   * quotes it and never follows it (`store/quarantine.ts`); `off` gives it no passage and no keyword entry.
   */
  quarantineRecall: environment("LOUVAIN_QUARANTINE_RECALL"),
});

/** The engine's settings, read from the environment when called (`config` below is read once, at import). */
export const engineConfig = () => ({
  ...databaseSettings(),
  ...processSettings(),
});

/** The engine's settings, read once at import: the object an application extends with its own. */
export const config = engineConfig();

/** The database an engine's own entry opens its store on (`DATABASE_URL`, read by the one environment reader). */
export const databaseUrl = (): string => environment("DATABASE_URL");

/**
 * The store an engine's own entry opens on `databaseUrl()` (`store/pool.ts` `openStore`): the database settings above and
 * every read's statement timeout, read once, at import.
 */
export const storeSettings: Parameters<typeof openStore>[1] = {
  prepare: config.dbPrepare,
  planCacheMode: config.dbPlanCacheMode,
  planCacheScope: config.dbPlanCacheScope,
  jit: config.dbJit,
  poolMax: config.dbPoolMax,
  readTimeoutMs: environment("LOUVAIN_READ_STATEMENT_TIMEOUT_MS"),
};
