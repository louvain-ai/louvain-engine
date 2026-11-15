import type { Embedder } from "@louvain/embeddings";
import type { Host, PluginRegistry } from "@louvain/engine-core";
import type { TransactionSql } from "postgres";
import type { Settings } from "./config/settings.js";
import { type ReadContext, readContextOf } from "./kg/read/fence.js";
import type { ReadHooks } from "./kg/read/hooks.js";
import type { Store } from "./store.js";
import type { EngineHooks, Writes } from "./writes.js";

/**
 * THE ENGINE: one value, built by its caller from parts it chose and handed to whatever serves, ingests or searches.
 * Nothing here opens a pool, starts a plugin or reads the environment. A part the caller did not pass is a type
 * error, never a default, so what an engine runs on is whatever its builder wrote.
 */
export type EngineParts = {
  /** The pool it reads and writes through (`store.ts`). */
  readonly store: Store;
  /** How text becomes vectors. */
  readonly embedder: Embedder;
  /** The configuration's plugins, started (`createPluginRegistry`). */
  readonly plugins: PluginRegistry;
  /** What the deployment decides: who may read what, and how a work item's effects are committed. */
  readonly host: Host<TransactionSql>;
  /** The engine's settings, parsed (`settingsOf`). */
  readonly settings: Settings;
  /**
   * What a build adds to the open engine, its reads' and its writes' (`writes.ts`); the open build passes none, and each
   * absent hook is the open build's own (`hooksOf`, `writeHooksOf`).
   */
  readonly hooks?: EngineHooks;
};

export type Engine = EngineParts & {
  /** What its reads run on: the store and its pool, the host's resolver of who may read what, and the hooks. */
  readonly context: ReadContext;
  /** What its writes run on: the store's pool and the hooks (`writes.ts`). */
  readonly writes: Writes;
  /** Closes the plugins, latest first, then ends the store, which is ended even when a plugin fails to close. */
  close(): Promise<void>;
};

/** What a build's reads ask of its hooks, and nothing only its writes ask: a read's context carries no write hook. */
const readHooksOf = ({
  passageRules: _cut,
  passageWrites: _after,
  ...read
}: EngineHooks): ReadHooks => read;

export function createEngine(parts: EngineParts): Engine {
  return Object.freeze({
    ...parts,
    context: readContextOf(
      { store: parts.store, sql: parts.store.sql },
      parts.host.readableSet,
      parts.hooks ? readHooksOf(parts.hooks) : undefined,
    ),
    writes: { sql: parts.store.sql, hooks: parts.hooks ?? {} },
    close: async () => {
      try {
        await parts.plugins.close();
      } finally {
        await parts.store.end();
      }
    },
  });
}
