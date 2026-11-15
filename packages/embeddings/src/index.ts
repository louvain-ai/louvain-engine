/**
 * THE EMBEDDING CLIENT: one object, made once from its settings (`createEmbedder`), that embeds documents and queries
 * through a sidecar when one is configured and in process otherwise, says whether its sidecars are healthy, and names
 * the space its vectors are in. It holds what it loads and remembers (the model, the last stated space, whether an
 * outage was said); nothing in this package is module state.
 */
import type { SidecarEndpoints } from "@louvain/engine-core";
import { createLocal, fitDimensions as fit } from "./local.js";
import { createRemote, type EmbedLane, type RemoteFailure } from "./remote.js";
import { EmbeddingsSettings, type EmbeddingsSettingsValue, modelSettingsOf } from "./settings.js";
import { createSpace } from "./space.js";
import { localSpaceStatement, sidecarDisagreement } from "./space-statement.js";

export {
  EmbeddingFailed,
  type EmbeddingFailure,
  EmbeddingUnavailable,
} from "./errors.js";
export type { EmbedLane, RemoteFailure } from "./remote.js";
export {
  EMBEDDING_DIM,
  type EmbeddingSettings,
  EmbeddingsSettings,
  type EmbeddingsSettingsValue,
} from "./settings.js";
export type { EmbeddingSpace } from "./space.js";
export { spaceDifferences, statedSpace } from "./space-statement.js";
export { cosineSim, toPgVector } from "./vector.js";

/** A query embedding as it happened: how long it took, whether it produced a vector, and in which model's space. */
export type QueryEmbedTiming = { ms: number; outcome: "ok" | "empty" | "error"; model: string };

/**
 * How an embedder reaches its sidecars and tells its host what happened. `endpoints`: the deployment's (unset, every
 * sidecar is plain HTTP that is always up). `observe.query`: every query embedding's time, read where it runs, since
 * it is on the path of every question someone is waiting on. `observe.failure`: every failed remote embed (the outage
 * is logged once, so a count is needed). `pause`: the wait between a bulk lane's reconnects.
 */
export type EmbedderOptions = {
  endpoints?: SidecarEndpoints | undefined;
  observe?: {
    query?: ((t: QueryEmbedTiming) => void) | undefined;
    failure?: ((failure: RemoteFailure) => void) | undefined;
  };
  pause?: ((ms: number) => Promise<void>) | undefined;
};

/** The settings as the environment holds them now: what an embedder made without explicit settings is read from. */
export const settingsFromEnv = (): EmbeddingsSettingsValue => EmbeddingsSettings.parse(process.env);

/**
 * An embedder from its settings: a parsed value, or a function read once on first use (so a process that sets its
 * environment after importing a module still embeds by what it set).
 */
export function createEmbedder(
  settings: EmbeddingsSettingsValue | (() => EmbeddingsSettingsValue) = settingsFromEnv,
  options: EmbedderOptions = {},
) {
  let read: EmbeddingsSettingsValue | undefined;
  const value = (): EmbeddingsSettingsValue => {
    read ??= typeof settings === "function" ? settings() : settings;
    return read;
  };
  const model = () => modelSettingsOf(value());
  const remote = createRemote(
    () => {
      const s = value();
      return {
        endpoint: s.LOUVAIN_EMBEDDINGS_URL,
        bulkEndpoint: s.LOUVAIN_EMBEDDINGS_BULK_URL || s.LOUVAIN_EMBEDDINGS_URL,
        timeoutMs: s.LOUVAIN_EMBEDDINGS_TIMEOUT_MS,
        bulkTimeoutMs: s.LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS,
        localFallback: s.LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK,
        requestBatch: s.LOUVAIN_EMBEDDINGS_REQUEST_BATCH,
        token: s.LOUVAIN_SIDECAR_TOKEN,
        model: model(),
      };
    },
    { endpoints: options.endpoints, onFailure: options.observe?.failure, pause: options.pause },
  );
  const embedLocal = createLocal(() => ({
    model: model(),
    threads: value().LOUVAIN_EMBEDDINGS_THREADS,
    cacheDir: value().HF_HOME ?? value().TRANSFORMERS_CACHE,
  }));
  const spaces = createSpace(remote, model);

  /** Embed documents: stored text, no instruction prefix. */
  async function embed(texts: string[], lane: EmbedLane = "bulk"): Promise<number[][]> {
    if (texts.length === 0) return [];
    // A configured sidecar embeds; with local fallback off its failure is an error, never a slower local embed.
    const vectors = await remote.remoteEmbed(texts, lane);
    // The sidecar cuts a Matryoshka model itself; this refuses one that returned a width no column holds.
    if (vectors) return fit(vectors, model().matryoshka);
    return embedLocal(texts);
  }

  /** Time a query embedding for the host, whichever way it ends. */
  async function timed(name: string, run: () => Promise<number[]>): Promise<number[]> {
    const started = performance.now();
    let outcome: QueryEmbedTiming["outcome"] = "error";
    try {
      const v = await run();
      outcome = v.length > 0 ? "ok" : "empty";
      return v;
    } finally {
      options.observe?.query?.({ ms: performance.now() - started, outcome, model: name });
    }
  }

  return {
    /** The model's conventions. */
    settings: model,
    embed,
    /** Embed a query: the search side of the asymmetric pair, on the interactive lane (someone is waiting on it). */
    embedQuery: (text: string): Promise<number[]> =>
      timed(
        model().model,
        async () => (await embed([model().queryInstruction + text], "interactive"))[0] ?? [],
      ),
    embedLocal,
    fitDimensions: (vectors: number[][]): number[][] => fit(vectors, model().matryoshka),
    remoteConfigured: remote.remoteConfigured,
    bulkOnDemand: remote.bulkOnDemand,
    wakesOnRequest: remote.wakesOnRequest,
    laneWakesOnRequest: remote.laneWakesOnRequest,
    sidecarHealthz: remote.sidecarHealthz,
    remoteHealth: remote.remoteHealth,
    remoteTokenCounts: remote.remoteTokenCounts,
    /** Whether a sidecar's `/healthz` agrees with this embedder's model (null), or how it does not. */
    sidecarDisagreement: (health: { model?: unknown; pooling?: unknown; dimensions?: unknown }) =>
      sidecarDisagreement(health, model()),
    /** The space this embedder's own model embeds in. */
    localSpaceStatement: () => localSpaceStatement(model()),
    space: spaces.space,
    spaceUnstated: spaces.spaceUnstated,
  };
}

export type Embedder = ReturnType<typeof createEmbedder>;
