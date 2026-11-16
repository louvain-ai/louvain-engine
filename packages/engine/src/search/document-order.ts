/**
 * The documents a page points at, best first: the page regrouped by record and reordered by the reranker where there is
 * one. The reader's whole-document page and an agent's search both read this one order.
 */
import type { Reranker } from "@louvain/engine-core";
import { envSetting } from "../config/env-setting.js";
import type { Settings as EngineSettings } from "../config/settings.js";
import { rankDocuments } from "../read/documents/page-row.js";
import type { AskSettings } from "../read/question.js";
import type { AskRow } from "./evidence.js";
import { type DocumentFeed, rerankedDocuments } from "./rerank-documents.js";

/** What a document's other passages add to its best. An agent picks one document, so its dial defaults to none. */
export const AGENT_SEARCH_CHUNK_BONUS = envSetting("LOUVAIN_AGENT_SEARCH_CHUNK_BONUS", 0, {
  integer: false,
});

type OrderInput = {
  rows: readonly AskRow[];
  pool: readonly AskRow[];
  query: string;
  settings: Pick<AskSettings, "rerank">;
  chunkBonus: number;
  /** Where a document's whole text is read from, when the reranker is fed documents. */
  feed?: DocumentFeed;
  /** The reranker, used where the mode reranks (`settings.rerank`); left out or `null`, none. */
  reranker?: Reranker | null;
  /** The engine's reranking settings: its window, what stands for a document, and the blend. */
  tuning: EngineSettings["rerank"];
};

/**
 * `loose` are the rows that belong to no record's passages; `relevance` is each scored document's reranker score;
 * `degraded` names what the reranker could not do.
 */
export async function documentOrder(input: OrderInput) {
  const { ranked, loose } = rankDocuments([...input.rows], [...input.pool], input.chunkBonus);
  if (ranked.length === 0)
    return { order: ranked, loose, relevance: null, reranker: null, degraded: [] };
  const reranker = input.settings.rerank ? (input.reranker ?? null) : null;
  const reranked = await rerankedDocuments(ranked, loose, {
    query: input.query,
    reranker,
    tuning: input.tuning,
    ...(input.feed ? { feed: input.feed } : {}),
  });
  const by = reranked.relevance ? reranker : null;
  const { order, relevance, degraded } = reranked;
  return { order, loose, relevance, reranker: by, degraded };
}
