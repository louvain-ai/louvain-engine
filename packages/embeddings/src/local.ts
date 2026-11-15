/**
 * The in-process model: bge-base-en-v1.5 through transformers.js (ONNX, CPU), loaded on first use and held by the
 * embedder that made it, its library imported then too (`pipelineFor`). A configured sidecar is the endpoint, so
 * nothing here routes back through it.
 */
import { EMBEDDING_DIM, type EmbeddingSettings } from "./settings.js";

/**
 * Cut a Matryoshka model's vectors to `EMBEDDING_DIM` and re-normalise, as the sidecar does; refuse a wider vector from a
 * model not declared Matryoshka rather than write it into a column it does not fit.
 */
export function fitDimensions(vectors: number[][], matryoshka: boolean): number[][] {
  return vectors.map((v) => {
    if (v.length <= EMBEDDING_DIM) return v;
    if (!matryoshka) {
      throw new Error(
        `embedding model produced ${v.length} dimensions, expected ${EMBEDDING_DIM}; set LOUVAIN_EMBEDDING_MATRYOSHKA=true only for a Matryoshka-trained model`,
      );
    }
    const cut = v.slice(0, EMBEDDING_DIM);
    const norm = Math.sqrt(cut.reduce((sum, x) => sum + x * x, 0)) || 1;
    return cut.map((x) => x / norm);
  });
}

type Extractor = (
  texts: string[],
  opts: { pooling: "mean" | "last_token"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** The sidecar's `MAX_TOKENS`. */
const MAX_TOKENS = 512;

/** Texts per forward pass of the in-process path, grouped by length. */
const MICRO_BATCH = 16;

/** What the in-process model is made from: the model's conventions, its threads and where its files are cached. */
export type LocalSettings = {
  model: EmbeddingSettings;
  threads: number | undefined;
  cacheDir: string | undefined;
};

/**
 * The model's pipeline, the library imported here on the first local embed: it loads native code and probes the machine
 * as it loads, which a process that only imports the engine, or embeds through a sidecar, never pays.
 */
async function pipelineFor({ model, threads, cacheDir }: LocalSettings) {
  const { env: hfEnv, pipeline } = await import("@huggingface/transformers");
  // The library's default cache sits inside its own package, ignores `HF_HOME` and `TRANSFORMERS_CACHE`, and is not
  // writable by a container's runtime user, so the mounted cache is named explicitly.
  if (cacheDir) hfEnv.cacheDir = cacheDir;
  return pipeline("feature-extraction", model.model, {
    dtype: "fp32",
    // Bound native threads to the deployment's CPU allocation when configured.
    ...(threads !== undefined
      ? { session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } }
      : {}),
  });
}

/** A loaded pipeline whose tokenizer is bound to `MAX_TOKENS`, or a throw where the library will not be bound. */
function boundTokenizer<T>(loaded: T): T {
  // Both paths cut at MAX_TOKENS: the tokenizer's own maximum differs by model, so a long text would embed two ways.
  // The pipeline takes no `max_length`, so the tokenizer config is set and read back; a library that ignores it fails here.
  const tokenizer = (
    loaded as unknown as {
      tokenizer?: {
        model_max_length: number;
        _tokenizerConfig?: { model_max_length?: number };
      };
    }
  ).tokenizer;
  const config = tokenizer?._tokenizerConfig;
  if (!tokenizer || !config)
    throw new Error("embedding: the tokenizer exposes no config to bound its length");
  config.model_max_length = Math.min(
    config.model_max_length ?? Number.POSITIVE_INFINITY,
    MAX_TOKENS,
  );
  if (tokenizer.model_max_length > MAX_TOKENS) {
    throw new Error(`embedding: could not bound the tokenizer to ${MAX_TOKENS} tokens`);
  }
  return loaded;
}

/** The in-process model, loaded on its first embed and held for the embedder's life. */
export function createLocal(
  settings: () => LocalSettings,
): (texts: string[]) => Promise<number[][]> {
  let extractor: Promise<Extractor> | undefined;

  function load(): Promise<Extractor> {
    extractor ??= pipelineFor(settings()).then(boundTokenizer) as unknown as Promise<Extractor>;
    return extractor;
  }

  /** The sidecar is the endpoint: it must never route back through the remote client. */
  return async function embedLocal(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const run = await load();
    const { model } = settings();
    if (model.pooling === "mean") {
      // Shortest first in groups, each padded only to its own longest; masked mean pooling makes a vector independent of its group.
      const order = texts
        .map((_, i) => i)
        .sort((a, b) => (texts[a]?.length ?? 0) - (texts[b]?.length ?? 0));
      const vectors: number[][] = new Array(texts.length);
      for (let at = 0; at < order.length; at += MICRO_BATCH) {
        const group = order.slice(at, at + MICRO_BATCH);
        const out = await run(
          group.map((i) => texts[i] as string),
          { pooling: "mean", normalize: true },
        );
        const rows: number[][] = out.tolist();
        group.forEach((i, k) => {
          vectors[i] = rows[k] ?? [];
        });
      }
      return fitDimensions(vectors, model.matryoshka);
    }
    // `last_token` pools the last position, which is the last token only when unpadded, so each text runs alone.
    const vectors: number[][] = [];
    for (const text of texts) {
      const [v] = (await run([text], { pooling: "last_token", normalize: true })).tolist();
      vectors.push(v ?? []);
    }
    return fitDimensions(vectors, model.matryoshka);
  };
}
