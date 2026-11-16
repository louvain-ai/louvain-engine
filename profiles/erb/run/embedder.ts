import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installSetting } from "./install.js";
import type { Place } from "./steps.js";

/**
 * The scored embedder, which every profile of this run indexes and queries with: `Louvain/embed-4b-erb` at commit
 * 7b9a14bf, served by the embedding sidecar (`services/embed/embed.py`, torch backend) you start yourself (README.md). Its
 * conventions go to `./engine` from the environment, since the engine applies the query instruction and records the
 * model with every vector; `check` and `load` refuse an embedding service that is not this model, so a run can never
 * index with the default embedder unnoticed.
 */
const TUNED = {
  model: "Louvain/embed-4b-erb",
  pooling: "last",
  dimensions: 768,
  matryoshka: true,
  weights: "771b1d5b1419e49b588febfc655e469e27ebd3d72031a5a00624f711cade530b",
} as const;

/** The model's conventions, as the engine reads them (`packages/embeddings` settings); `\n` is a newline there. */
export const EMBEDDER_ENV: Readonly<Record<string, string>> = {
  LOUVAIN_EMBEDDING_MODEL: TUNED.model,
  LOUVAIN_EMBEDDING_POOLING: TUNED.pooling,
  LOUVAIN_EMBEDDING_MATRYOSHKA: "true",
  LOUVAIN_EMBEDDING_QUERY_INSTRUCTION:
    "Instruct: Given a question about a company's work, retrieve the passages that answer it\\nQuery: ",
};

/** Each embedding service the engine calls (queries, and indexing when it has its own) is the tuned 4B, or this throws. */
export async function embedderAnswers(p: Place, signal: AbortSignal): Promise<void> {
  const port = installSetting(p.engineRoot, "LOUVAIN_EMBEDDINGS_HOST_PORT") ?? "8091";
  const query =
    installSetting(p.engineRoot, "LOUVAIN_EMBEDDINGS_URL") ?? `http://localhost:${port}`;
  const bulk = installSetting(p.engineRoot, "LOUVAIN_EMBEDDINGS_BULK_URL");
  const token = readFileSync(join(p.state, "sidecar-token"), "utf8").trim();
  for (const url of new Set([query, ...(bulk ? [bulk] : [])])) {
    const health = await healthOf(url.replace(/\/$/, ""), token, signal);
    const wrong = Object.entries(TUNED).filter(([field, want]) => health[field] !== want);
    if (wrong.length > 0)
      throw new Error(
        `the embedding service at ${url} is not ${TUNED.model}: ${wrong
          .map(
            ([field, want]) =>
              `${field} ${JSON.stringify(health[field])}, not ${JSON.stringify(want)}`,
          )
          .join("; ")} (README.md says how to serve it)`,
      );
    console.log(`embedding service ${url}: ${TUNED.model}, weights ${TUNED.weights.slice(0, 8)}`);
  }
}

async function healthOf(url: string, token: string, signal: AbortSignal) {
  const res = await fetch(`${url}/healthz`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal,
  }).catch((err: unknown) => {
    throw new Error(`the embedding service at ${url} did not answer (${String(err)})`);
  });
  if (!res.ok) throw new Error(`the embedding service at ${url} answered ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}
