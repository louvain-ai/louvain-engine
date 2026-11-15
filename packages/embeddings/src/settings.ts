/**
 * The embedding model's identity and conventions: what every vector is made with, read from the deployment. EVERY
 * SETTING THIS PACKAGE READS is declared once, here, as the engine declares its own (`@louvain/engine/config/settings`,
 * which composes this one): `AtLoad`, read once and memoised by what builds from it (the model, the sidecar's
 * address), and `Live`, read at each call.
 * Where a setting's trimming or words are not plain zod, a short transform on its field says them.
 */
import { z } from "zod";

export const EMBEDDING_DIM = 768;
/** The default model, and the one every stored vector came from unless a deployment says otherwise. */
export const EMBEDDING_MODEL = "Xenova/bge-base-en-v1.5";

/** BGE's trained retrieval instruction — queries only, verbatim. */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const raw = z.string().optional();

/**
 * A whole number above 0, or nothing when the setting is unset or empty. Anything else stops the start with the one
 * sentence every such setting gives: a value that does not parse is never read as another.
 */
function wholeOf(name: string, v: string | undefined): number | undefined {
  const text = (v ?? "").trim();
  if (text === "") return undefined;
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${name} must be a whole number above 0, not ${JSON.stringify(v)}`);
  return n;
}
/** `wholeOf`, with the value an unset setting takes. */
const whole = (name: string, fallback: number) =>
  raw.transform((v) => wholeOf(name, v) ?? fallback);

/** Read once, by what builds from it, and memoised there. */
const AtLoad = z.object({
  LOUVAIN_EMBEDDING_MODEL: raw
    .transform((v) => v?.trim() || EMBEDDING_MODEL)
    .describe(
      "The embedding model; unset is bge-base-en-v1.5, the model every stored vector came from. Internal: the sidecar names its model, and the two must agree.",
    ),
  LOUVAIN_EMBEDDING_POOLING: raw
    .transform((v) => {
      const pooling = (v ?? "mean").trim();
      if (pooling !== "mean" && pooling !== "last")
        throw new Error(
          `LOUVAIN_EMBEDDING_POOLING must be mean or last, not ${JSON.stringify(pooling)}`,
        );
      return pooling;
    })
    .describe(
      "How the model's token vectors become one: `mean` (default) or `last`. Internal: set with the model it belongs to.",
    ),
  LOUVAIN_EMBEDDING_QUERY_INSTRUCTION: raw
    .transform((v) => (v === undefined ? QUERY_PREFIX : v.replaceAll("\\n", "\n")))
    .describe(
      "The instruction before a query (never a document); `\\n` is a newline. Unset is bge's. Internal: set with the model it belongs to.",
    ),
  LOUVAIN_EMBEDDINGS_URL: raw.describe(
    "The embedding sidecar for queries; unset, the model runs in this process.",
  ),
  LOUVAIN_EMBEDDINGS_BULK_URL: raw.describe(
    "The embedding sidecar for indexing; unset, the query sidecar's.",
  ),
  LOUVAIN_EMBEDDINGS_TIMEOUT_MS: whole("LOUVAIN_EMBEDDINGS_TIMEOUT_MS", 30_000).describe(
    "How long a query's embedding may take, in milliseconds. Internal: a measured bound; its default is the measured one.",
  ),
  LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS: whole("LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS", 180_000).describe(
    "How long an indexing batch's embedding may take, in milliseconds. Internal: a measured bound; its default is the measured one.",
  ),
  LOUVAIN_EMBEDDINGS_REQUEST_BATCH: whole("LOUVAIN_EMBEDDINGS_REQUEST_BATCH", 8)
    .transform((n) => Math.min(n, 256))
    .describe(
      "Texts in one request to the sidecar (8; at most 256). Internal: a measured bound; its default is the measured one.",
    ),
  LOUVAIN_EMBEDDINGS_THREADS: raw
    .transform((v) => wholeOf("LOUVAIN_EMBEDDINGS_THREADS", v))
    .describe(
      "Native threads for the in-process model; unset, the library's. Internal: set by the deployment that runs the engine, not by a person.",
    ),
  HF_HOME: raw.describe(
    "Where the in-process model's files are cached. Internal: set by the deployment that runs the engine, not by a person.",
  ),
  TRANSFORMERS_CACHE: raw.describe(
    "The same cache, by its older name, when HF_HOME is unset. Internal: set by the deployment that runs the engine, not by a person.",
  ),
});

/** Read at each call. */
const Live = z.object({
  LOUVAIN_EMBEDDING_MATRYOSHKA: raw
    .transform((v) => v === "true")
    .describe(
      "A wider Matryoshka-trained model is cut to 768 dimensions; only `true`. Internal: set with the model it belongs to.",
    ),
  LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK: raw
    .transform((v) => v === "true")
    .describe(
      "A failed sidecar call yields to the in-process model instead of failing; only `true`. Internal: a rollout, off by default.",
    ),
  LOUVAIN_SIDECAR_TOKEN: raw
    .transform((v) => (v || "").trim())
    .describe("The bearer every call to one of the engine's sidecars carries."),
});

/** Every setting this package reads, for the engine's declaration to compose. */
export const EmbeddingsSettings = AtLoad.extend(Live.shape);
/** Every setting this package reads, parsed: what an embedder is made from (`createEmbedder`). */
export type EmbeddingsSettingsValue = z.output<typeof EmbeddingsSettings>;

/**
 * The model's own conventions, as configuration: a vector is only comparable to vectors made the same way, so the
 * pooling, query instruction and width are read from the deployment, and the Python sidecar reads the same names.
 * Unset, each is what bge-base uses. `LOUVAIN_EMBEDDING_MODEL`, `_POOLING` (`mean` | `last`), `_QUERY_INSTRUCTION`
 * (queries only; `\n` is a newline) and `_MATRYOSHKA` (`true` cuts a wider model to `EMBEDDING_DIM`; declared, never
 * inferred).
 */
export type EmbeddingSettings = {
  model: string;
  pooling: "mean" | "last";
  queryInstruction: string;
  matryoshka: boolean;
};

/** The model's conventions, from the parsed settings. */
export function modelSettingsOf(s: EmbeddingsSettingsValue): EmbeddingSettings {
  return {
    model: s.LOUVAIN_EMBEDDING_MODEL,
    pooling: s.LOUVAIN_EMBEDDING_POOLING === "last" ? "last" : "mean",
    // An env file cannot hold a newline, and Qwen3's instruction has one: `\n` in the value is one.
    queryInstruction: s.LOUVAIN_EMBEDDING_QUERY_INSTRUCTION,
    matryoshka: s.LOUVAIN_EMBEDDING_MATRYOSHKA,
  };
}
