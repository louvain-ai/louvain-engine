/** The evaluator's repository at the scored commit, and the corpus archive of the benchmark's release, by sha256. */
export const BENCHMARK = {
  repository: "https://github.com/onyx-dot-app/EnterpriseRAG-Bench",
  commit: "d36685e273713975ee20299bbf1ab64165575b3c",
  corpus:
    "https://github.com/onyx-dot-app/EnterpriseRAG-Bench/releases/latest/download/all_documents.zip",
  corpusSha256: "9d1174928696ad08bc15f3f104739519de633c1605a4ec2034e0e3c0087bc5cd",
} as const;

export const SCORED_MODEL = {
  model: "claude-sonnet-5-5",
  effort: "medium",
  maxOutputTokens: 4_000,
} as const;
export const JUDGE_MODEL = "claude-haiku-5-5";
export const RERANK_MODEL = "rerank-v4.0-pro";

/**
 * The one scored search setting the engine still reads from the environment, given to `./engine up`: the relevance
 * split off, with its exact-first ordering and near-word correction, none of which the scored build had. The others
 * are `settings` in this profile's engine.config.ts.
 */
export const SCORED_SEARCH: Readonly<Record<string, string>> = {
  LOUVAIN_SEARCH_RELEVANCE: "off",
};
