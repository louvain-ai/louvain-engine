import type { RelevanceCutoffs } from "@louvain/engine-core";

/** Why a document matches: the strongest signal that says so, strongest first. */
export type By = "exact" | "words" | "relevance" | "meaning";

/** What a page knows of a document: its words, its meaning, whether the search names it, the reranker's score. */
type Signals = { words: boolean; meaning: number | null; exact?: true; relevance?: number };

/**
 * A DOCUMENT MATCHES WHEN ANY SIGNAL SAYS SO, and `by` names the strongest: it is what the search names, it holds the
 * search's words, the reranker scores it at or above its model's measured cut-off, or its meaning reaches the
 * embedder's floor. A low score hides nothing: a cross-encoder scores an answer worded differently from its question
 * near zero, as low as it scores a word no document holds, so the rest are listed apart as loosely related.
 */
export function matchedBy(
  m: Signals,
  floor: number | undefined,
  cutoffs: RelevanceCutoffs | undefined,
): By | undefined {
  if (m.exact) return "exact";
  if (m.words) return "words";
  if (cutoffs && m.relevance !== undefined && m.relevance >= cutoffs.matched) return "relevance";
  if (floor !== undefined && m.meaning !== null && m.meaning >= floor) return "meaning";
  return undefined;
}

/** A head document's signals with what the search found beside it: the exact tier, the reranker's score, the ranks. */
export function withFound<M extends Signals>(
  m: M,
  d: { exact?: true; relevance?: number; ranks?: { words: number | null; meaning: number | null } },
) {
  return {
    ...m,
    ...(d.exact ? { exact: true as const } : {}),
    ...(typeof d.relevance === "number"
      ? { relevance: Math.round(d.relevance * 1000) / 1000 }
      : {}),
    ...(d.ranks ? { ranks: d.ranks } : {}),
  };
}
