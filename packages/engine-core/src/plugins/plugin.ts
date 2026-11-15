import { prettifyError, type z } from "zod";
import type { Answerer } from "../ask/answerer.js";
import type { FileReader } from "../file-readers/contract.js";
import type { Source } from "../ingest-sources/contract.js";
import type { Reranker } from "../search/reranker.js";
import type { Retriever } from "../search/retriever.js";
import type { NotReady } from "./kinds.js";
import type { Surface } from "./surface.js";

/**
 * WHAT A PLUGIN OF EACH KIND IS. A plugin adds a capability, and the engine's configuration names the ones that run.
 * The kinds are this type's keys and nothing else is one, so a kind that is not here does not compile.
 */
export type Contracts = {
  fileReader: FileReader;
  retriever: Retriever;
  reranker: Reranker;
  source: Source;
  answerer: Answerer;
  surface: Surface;
};

/**
 * A PLUGIN: a capability of one kind, under a name unique within it. A plugin exports one factory, made by
 * `definePlugin`, which the configuration calls with its settings; they are parsed then, so a wrong one stops the
 * start at the line that wrote it. `create` runs once, at start, and may wait; a plugin holding something open offers
 * `close`.
 */
export type Plugin<K extends keyof Contracts, R extends Started<K> = Started<K>> = {
  readonly kind: K;
  readonly name: string;
  create(): R | Promise<R>;
  close?(started: Contracts[K]): void | Promise<void>;
};

/** What a plugin of a kind may start as: its contract, or `notReady` with the setting it needs. */
type Started<K extends keyof Contracts> = Contracts[K] | NotReady;

type Spec<K extends keyof Contracts, S, R extends Started<K>> = Pick<
  Plugin<K>,
  "kind" | "name" | "close"
> & {
  create(settings: S): R | Promise<R>;
};

export function definePlugin<
  K extends keyof Contracts,
  S extends z.ZodType,
  R extends Started<K> = Contracts[K],
>(
  spec: Spec<K, z.output<S>, R> & { settings: S },
): (...s: Partial<z.input<S>> extends z.input<S> ? [z.input<S>?] : [z.input<S>]) => Plugin<K, R>;
export function definePlugin<K extends keyof Contracts, R extends Started<K> = Contracts[K]>(
  spec: Spec<K, void, R>,
): () => Plugin<K, R>;
export function definePlugin<K extends keyof Contracts>(
  spec: Spec<K, unknown, Started<K>> & { settings?: z.ZodType },
): (input?: unknown) => Plugin<K> {
  const { settings, create, ...plugin } = spec;
  return (input) => {
    const parsed = settings?.safeParse(input ?? {});
    if (parsed && !parsed.success)
      refuse(
        `the ${spec.kind} "${spec.name}" refuses its settings:\n${prettifyError(parsed.error)}`,
      );
    return { ...plugin, create: () => create(parsed?.data) };
  };
}

export class PluginRefused extends Error {}

export function refuse(sentence: string): never {
  throw new PluginRefused(sentence);
}
