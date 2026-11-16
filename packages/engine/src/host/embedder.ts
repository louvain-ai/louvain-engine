import { createEmbedder, type Embedder, settingsFromEnv } from "@louvain/embeddings";
import type { Host } from "@louvain/engine-core";

/** The embedder an open entry makes for the engine it builds: the environment's settings, the host's endpoints. */
export const embedderFor = (host: Pick<Host, "endpoints">): Embedder =>
  createEmbedder(settingsFromEnv, { endpoints: host.endpoints });
