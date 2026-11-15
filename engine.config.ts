/**
 * What this install runs. A field left out keeps its default: the two file readers, the folder and records sources, the
 * tools at /mcp and the app at /app/, no reranker. The environment holds only addresses, ports and keys. The lines
 * commented out turn on the local reranker (a 2.3 GB download, best with a GPU), Cohere's, the HTTP ingest door (with
 * its own token), and the tools without the app. Ask answers with the agent over Anthropic's model, its key in
 * ANTHROPIC_API_KEY. Run ./engine down and ./engine up after a change.
 */
import { agent, anthropic } from "@louvain/engine-app";
import { defineEngine } from "@louvain/engine-core";
// import { sidecar } from "@louvain/reranker-sidecar";
// import { cohere } from "@louvain/reranker-cohere";
// import { folder, records } from "@louvain/engine";
// import { http } from "@louvain/source-http";
// import { mcp } from "@louvain/engine";

export default defineEngine({
  // reranker: sidecar({
  //   url: process.env.LOUVAIN_RERANK_URL ?? "http://localhost:8096",
  //   timeoutMs: Number(process.env.LOUVAIN_RERANK_TIMEOUT_MS ?? 30_000),
  // }),
  // reranker: cohere({ model: "rerank-v3.5" }), // Cohere's Rerank API, the key in COHERE_API_KEY
  // sources: [folder(), records(), http({ token: process.env.LOUVAIN_ENGINE_INGEST_TOKEN })],
  // surfaces: [mcp()], // the tools alone, with no app at /app/
  // settings: { rerank: { window: 10 } }, // rerank 10 documents, few enough for a CPU
  answerer: agent({ model: anthropic({ model: "claude-sonnet-5-5" }) }),
});
