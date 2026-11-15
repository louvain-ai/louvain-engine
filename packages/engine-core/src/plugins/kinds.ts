import type { Contracts } from "./plugin.js";

/** How many plugins of each kind a configuration may name: a search is reranked by one, a question answered by one. */
export const KINDS = {
  fileReader: "many",
  retriever: "many",
  source: "many",
  surface: "many",
  reranker: "one",
  answerer: "one",
} as const satisfies Record<keyof Contracts, "one" | "many">;

/**
 * What `create` returns for a plugin that cannot run as configured: the one setting that would make it run (a key the
 * environment lacks). The engine still starts; the plugin waits, and the registry says so (`one`, `waiting`).
 */
export type NotReady = { readonly notReady: string };

export const isNotReady = (value: unknown): value is NotReady =>
  typeof value === "object" && value !== null && typeof (value as NotReady).notReady === "string";
