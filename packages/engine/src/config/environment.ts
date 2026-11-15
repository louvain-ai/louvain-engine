/**
 * EVERY ENVIRONMENT NAME THE OPEN ENGINE READS, DECLARED ONCE: its name, what it accepts, its default and one line of
 * what it does. How a search reads and ranks is not here: that is `settings` in `engine.config.ts` (`settings.ts`). Two
 * schemas, by when a name is read: `AtLoad`, parsed once where its module loads (or where `config` is built), and
 * `Live`, parsed at each call, so one process can serve both arms of a measurement. `environment(name)` parses
 * one name from the environment as it is now; nothing else in the engine reads `process.env` for a name. A name
 * `.env.example` does not offer says why in its line ("Internal: …"); a test holds this declaration, `.env.example`
 * and the configuration page to each other.
 *
 * A value that is not one keeps today's answer: most fall back to their default with one line naming the setting
 * (`fellBack`); a file or server bound refuses the start (`refusal`). Where a setting's own trimming, words or arithmetic
 * are not plain zod, a short transform on the field says them. The embeddings package declares its own
 * (`EmbeddingsSettings`), composed below, so `environment` reads every name.
 */
import { EmbeddingsSettings } from "@louvain/embeddings";
import { z } from "zod";
import { jitSetting, planCacheModeSetting, planCacheScopeSetting } from "../db-settings.js";

/** The database when `DATABASE_URL` is unset: local, with no credential (`./engine` sets `DATABASE_URL` from `.engine/db-password`). */
export const DEFAULT_DATABASE_URL = "postgres://localhost:5432/engine";

const MAX_INT = 2_147_483_647;
const warn = (message: string) => console.warn(message);

/** Blank is absent: compose writes an unset optional as an empty string. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** The one line a value that is not one costs, and the default it falls back to. */
function fellBack<T>(name: string, raw: unknown, wanted: string, fallback: T): T {
  warn(`config: ${name}=${JSON.stringify(raw)} is not ${wanted}; using ${fallback}`);
  return fallback;
}

/** A file or server bound that is not one refuses the start, naming the setting. */
function refusal(name: string, raw: unknown, min: number): Error {
  return new Error(`${name} must be a number of at least ${min}, got "${raw}"`);
}

/** `Math.max(floor, Number(raw ?? fallback) || fallback)`: blank, zero and garbage are the default. */
const orDefault = (raw: string | undefined, fallback: number) =>
  Number(raw ?? fallback) || fallback;

/** Text, with blank read as absent. */
const text = z.preprocess(blank, z.string().optional());
/** Text exactly as set, blank included. */
const raw = z.string().optional();

/** Read once, where the module that uses it loads, or where `config` is built (`engine.ts`). */
const AtLoad = z.object({
  DATABASE_URL: text
    .transform((v) => v ?? DEFAULT_DATABASE_URL)
    .describe("The Postgres the engine reads and writes; unset is local, with no credential."),
  LOUVAIN_DB_PREPARE: z
    .string()
    .default("true")
    .transform((v) => v === "true")
    .describe(
      "Protocol-level prepared statements; anything but `true` turns them off (a transaction pooler). Internal: database tuning for a pooled or managed Postgres.",
    ),
  LOUVAIN_DB_PLAN_CACHE_MODE: raw
    .transform((v) => planCacheModeSetting(v, warn))
    .describe(
      "How a prepared statement is planned: force_custom_plan (default), auto, force_generic_plan, or off. Internal: database tuning for a pooled or managed Postgres.",
    ),
  LOUVAIN_DB_PLAN_CACHE_SCOPE: raw
    .transform((v) => planCacheScopeSetting(v, warn))
    .describe(
      "Where the plan mode is set: `reads` (bounded reads, default) or `connection` (at connect too). Internal: database tuning for a pooled or managed Postgres.",
    ),
  LOUVAIN_DB_JIT: raw
    .transform((v) => jitSetting(v, warn))
    .describe(
      "`off` (default): the connections never JIT-compile; `server`: leave it to the server. Internal: database tuning for a pooled or managed Postgres.",
    ),
  LOUVAIN_DB_POOL_MAX: z
    .preprocess(blank, z.coerce.number().int().min(1).max(MAX_INT).default(20))
    // swallowed: a value that is not one is the default, said in one line (`fellBack`).
    .catch((c) =>
      fellBack("LOUVAIN_DB_POOL_MAX", c.input, `an integer between 1 and ${MAX_INT}`, 20),
    )
    .describe(
      "Connections in the pool (20). Internal: database tuning for a pooled or managed Postgres.",
    ),
  LOUVAIN_ENVIRONMENT: text.describe(
    "Tags every error and event; unset is `production` under NODE_ENV=production, else `development`. Internal: set by the deployment that runs the engine, not by a person.",
  ),
  NODE_ENV: raw.describe(
    "Only `production` matters: it is the environment's default name. Internal: set by the deployment that runs the engine, not by a person.",
  ),
  LOUVAIN_RELEASE: text
    .transform((v) => v ?? "dev")
    .describe(
      "The release, for attributing a regression to a deploy. Internal: set by the deployment that runs the engine, not by a person.",
    ),
  LOUVAIN_WORKER_ID: raw.describe(
    "Which process holds a lease; unset is pid@host. Internal: set by the deployment that runs the engine, not by a person.",
  ),
  HOSTNAME: raw.describe(
    "The host in the default worker id. Internal: set by the deployment that runs the engine, not by a person.",
  ),
  LOUVAIN_QUARANTINE_RECALL: text
    .transform((v) => (v ?? "on") !== "off")
    .describe(
      "A quarantined record stays in recall, labelled; `off` excludes it whole. Internal: a kill switch, on by default.",
    ),
  LOUVAIN_READ_STATEMENT_TIMEOUT_MS: raw
    .transform((v) => Math.max(1_000, orDefault(v, 15_000)))
    .describe(
      "How long one read statement may run, in milliseconds. Internal: a measured bound; its default is the measured one.",
    ),
  LOUVAIN_FILE_MAX_BYTES: z
    .preprocess(
      blank,
      z.coerce
        .number()
        .min(1)
        .default(32 * 1024 * 1024),
    )
    .catch((c) => {
      throw refusal("LOUVAIN_FILE_MAX_BYTES", c.input, 1);
    })
    .describe("The largest file a reader opens, in bytes."),
  LOUVAIN_FILE_MAX_CHARS: z
    .preprocess(blank, z.coerce.number().min(1).default(1_000_000))
    .catch((c) => {
      throw refusal("LOUVAIN_FILE_MAX_CHARS", c.input, 1);
    })
    .describe("The most characters a file's reading keeps."),
  LOUVAIN_FILE_READ_DEADLINE_MS: z
    .preprocess(blank, z.coerce.number().min(1).default(60_000))
    .catch((c) => {
      throw refusal("LOUVAIN_FILE_READ_DEADLINE_MS", c.input, 1);
    })
    .describe("How long one file's reading may take, in milliseconds."),
  LOUVAIN_ENGINE_PORT: z
    .preprocess(blank, z.coerce.number().min(1).default(8080))
    .catch((c) => {
      throw refusal("LOUVAIN_ENGINE_PORT", c.input, 1);
    })
    .describe("The tool server's port on 127.0.0.1, from 1 to 65535."),
  LOUVAIN_ENGINE_TOKEN: raw.describe(
    "The tool server's bearer token; unset, one is made in .engine/token.",
  ),
  LOUVAIN_ENGINE_INGEST_TOKEN: raw.describe(
    "The HTTP door's token, as engine.config.ts hands it to http(); set alone, it opens nothing.",
  ),
  LOUVAIN_ENGINE_PUBLIC_ORIGIN: raw.describe(
    "The origin of a proxy in front of the tool server's pages.",
  ),
  LOUVAIN_LOG_JSON: raw
    .transform((v) => v === "true")
    .describe("Log lines are JSON outside production; only `true`. Internal: development only."),
  LOUVAIN_HNSW_EF_SEARCH: raw.describe(
    "The vector legs' HNSW ef_search (120, at least 24). Internal: a measured bound; its default is the measured one.",
  ),
});

/** Read at each call: one process can serve both arms of a measurement. */
const Live = z.object({
  // Also read once, at load, by `kg/read/question.ts`.
  LOUVAIN_ASK_DEADLINE_MS: raw
    .transform((v) => Math.max(1_000, orDefault(v, 25_000)))
    .describe(
      "One question's deadline, in milliseconds, which every model call shares. Internal: a measured bound; its default is the measured one.",
    ),
  LOUVAIN_SEARCH_RELEVANCE: z
    .string()
    .optional()
    .transform((v) => {
      const w = (v ?? "").trim().toLowerCase();
      return w === "on" ? true : w === "off" ? false : undefined;
    })
    .describe(
      "Whether a ranked page tells matches from loosely related documents; unset, the build decides.",
    ),
  LOUVAIN_LOG_LEVEL: raw
    .transform((v) => v === "debug")
    .describe("Debug lines are written; only `debug`. Internal: development only."),
  LOUVAIN_PROCESS_GROUP: raw
    .transform((v) => v || null)
    .describe(
      "The deployment's process group, as the log shipper's `process` label. Internal: set by the deployment that runs the engine, not by a person.",
    ),
  LOUVAIN_READ_DOCUMENTS_MAX: raw
    .transform((v) => Math.max(1, orDefault(v, 10)))
    .describe(
      "Documents a search hands over whole, in `normal`. Internal: a measured bound; its default is the measured one.",
    ),
  LOUVAIN_READ_DOCUMENTS_NEIGHBOURS: raw
    .transform((v) => Math.max(0, orDefault(v, 0)))
    .describe(
      "Documents added from the top documents' collections, in `normal`. Internal: a measured bound; its default is the measured one.",
    ),
  LOUVAIN_DOCUMENT_CHARS: raw
    .transform((v) => Math.max(1_000, orDefault(v, 24_000)))
    .describe(
      "Characters of one document handed over, in `normal`. Internal: a measured bound; its default is the measured one.",
    ),
  // Read in the search owner's files, at each call.
  LOUVAIN_SEARCH_POOL_DEPTH: raw.describe(
    "How many passages a search pools before ranking (72; at most 200). Internal: a measured bound; its default is the measured one.",
  ),
  LOUVAIN_SEARCH_RERANK_QUERY: raw.describe(
    "What the reranker scores: `question` (default), `query`, `question+query`. Internal: a rollout, off by default.",
  ),
  LOUVAIN_CHAT_NEIGHBOURS: raw.describe(
    "A chat hit's neighbours: `window` (default), `fill` or `off`. Internal: a rollout, off by default.",
  ),
  LOUVAIN_WIDE_PASS_MAX_PASSAGES: raw.describe(
    "Above this many readable passages the wide pass is not asked (50,000). Internal: a measured bound; its default is the measured one.",
  ),
  LOUVAIN_PASSAGE_WINDOW_EXACT: raw.describe(
    "A small date range is read exactly; `off` is the kill switch. Internal: a kill switch, on by default.",
  ),
  LOUVAIN_BM25_URL: raw.describe("The BM25 sidecar; unset, the lexical leg is Postgres's alone."),
  LOUVAIN_BM25_TIMEOUT_MS: raw.describe(
    "How long a BM25 call may take, in milliseconds (3,000). Internal: a measured bound; its default is the measured one.",
  ),
  LOUVAIN_SEARCH_WIDE: raw
    .transform((v) => (v ?? "").trim().toLowerCase() === "on")
    .describe(
      "A search's ranked head is 100 documents deep instead of 24; only `on`. Internal: a rollout, off by default.",
    ),
  LOUVAIN_BM25_FILTERED: raw.describe(
    "A filtered keyword search is ranked by BM25 too; only `on`. Internal: a rollout, off by default.",
  ),
});

/** The engine's and the embeddings package's, which the engine composes: one list of every name the open engine reads. */
const Declared = AtLoad.extend(Live.shape).extend(EmbeddingsSettings.shape);
type Declared = typeof Declared.shape;
export type EnvironmentName = keyof Declared;

/** One name, parsed from the environment as it is now. */
export function environment<K extends EnvironmentName>(
  name: K,
  env: NodeJS.ProcessEnv = process.env,
): z.output<Declared[K]> {
  return Declared.shape[name].parse(env[name]) as z.output<Declared[K]>;
}
