import type { AskMode } from "@louvain/engine-core";
import { environment } from "../config/environment.js";
import type { AskSettings } from "../kg/read/question.js";

/**
 * The mode table: what each answer mode spends on retrieval. A mode is on the request, not in the environment, because
 * one deployment serves both a quick search and a thorough one; the environment sets what `normal` means. `fast` reads
 * the first page once; `thorough` reads more documents whole, hops to their neighbours and allows a longer deadline.
 * Every mode reads the same fenced corpus: a mode changes cost and completeness, never what the asker may see. An
 * application's reader adds its own fields to each mode (rounds, windows, style, model calls) in its own table.
 */
export type { AskSettings };

/** What `normal` means here: the deployment's environment. */
function normal(): AskSettings {
  return {
    documents: environment("LOUVAIN_READ_DOCUMENTS_MAX"),
    neighbours: environment("LOUVAIN_READ_DOCUMENTS_NEIGHBOURS"),
    documentChars: environment("LOUVAIN_DOCUMENT_CHARS"),
    rerank: true,
    recall: "full",
    deadlineMs: environment("LOUVAIN_ASK_DEADLINE_MS"),
  };
}

/** The settings for one answer mode. */
export function askSettings(mode: AskMode): AskSettings {
  const base = normal();
  if (mode === "fast") return fastSettings(base);
  if (mode === "thorough") return thoroughSettings(base);
  return base;
}

/** One page found by the cheap legs, read once. */
function fastSettings(base: AskSettings): AskSettings {
  return { ...base, neighbours: 0, rerank: false, recall: "bounded" };
}

/**
 * Fifteen documents read whole at up to 24,000 characters each, the neighbourhood hop, the reranker the caller hands
 * in (`rerank`), and a longer deadline.
 */
function thoroughSettings(base: AskSettings): AskSettings {
  return {
    ...base,
    documents: Math.max(base.documents, 15),
    neighbours: Math.max(base.neighbours, 3),
    documentChars: Math.max(base.documentChars, 24_000),
    rerank: true,
    deadlineMs: Math.max(base.deadlineMs, 60_000),
  };
}
