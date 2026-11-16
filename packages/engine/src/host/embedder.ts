import { createEmbedder, type Embedder, settingsFromEnv } from "@louvain/embeddings";
import type { Host } from "@louvain/engine-core";

/**
 * The open build's own defaults where the environment names nothing. Texts in one request to the embedding sidecar:
 * 32, where the open embedder on a CPU (bge-base, ONNX, every core) peaks: 3.1 texts/s one at a time, 6.4/s in 16,
 * 6.9/s in 32 and in 64, measured on an M1 Max; the shared default of 8 suits an embedder on a GPU, not this one.
 */
const OPEN_DEFAULTS = { LOUVAIN_EMBEDDINGS_REQUEST_BATCH: "32" };

/** The embedder an open entry makes for the engine it builds: the environment's settings, the host's endpoints. */
export const embedderFor = (host: Pick<Host, "endpoints">): Embedder =>
  createEmbedder(() => settingsFromEnv(OPEN_DEFAULTS), { endpoints: host.endpoints });
