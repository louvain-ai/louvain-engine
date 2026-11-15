import type { Reranker, Viewer } from "@louvain/engine-core";
import { settings } from "../config/settings.js";
import type { ReadContext } from "../kg/read/fence.js";
import { passages } from "../kg/read/passages-api.js";
import { type Attempted, attempt } from "./degrade.js";
import type { AskRow } from "./evidence.js";
import { rowKey } from "./row-key.js";

/** The viewer and instant a document's whole text is read under: the search's own. */
export type DocumentFeed = { context: ReadContext; viewer: Viewer; asOf?: string };

type Ranked = readonly [string, { best: AskRow }];

/** The order after the reranker, each scored document's relevance (0 to 1) when it ran, and what it could not do. */
export type Reranked<T> = {
  order: T[];
  relevance: ReadonlyMap<string, number> | null;
  degraded: string[];
};

/**
 * What text stands for a document to the reranker (`settings.rerank.feed`). `passage`, the default: the passage that
 * ranked it, cut at `passageChars`. `document`: the whole document as `passages.asDocuments` reads it under the
 * viewer's fence, cut at `documentChars`. A failed read feeds every document
 * its passage and is named (`rerank:document_text`); a document the read returns nothing for is fed its passage too.
 */
async function documentTexts(
  ids: readonly string[],
  feed: DocumentFeed | undefined,
): Promise<Attempted<Map<string, string>>> {
  const { feed: fed, documentChars: maxChars } = settings().rerank;
  if (!feed || fed !== "document" || ids.length === 0) return { value: new Map(), degraded: [] };
  return attempt("rerank:document_text", new Map<string, string>(), () =>
    passages.asDocuments(feed.context, feed.viewer, ids, {
      maxChars,
      ...(feed.asOf ? { asOf: feed.asOf } : {}),
    }),
  );
}

/**
 * The reranker's scores, highest first, by candidate id; null when it could not answer, named `rerank:documents`.
 * A reranker that answers with a score missing or out of [0, 1] has not ranked, and is treated as one that failed.
 */
async function scored(
  reranker: Reranker,
  candidates: readonly { id: string; text: string }[],
  query: string,
): Promise<Attempted<(readonly [string, number])[] | null>> {
  return attempt("rerank:documents", null, async () => {
    const got = await reranker.rerank({ query, texts: candidates.map((c) => c.text) });
    if (!got.ok) throw new Error(`the reranker "${reranker.model}" failed: ${got.failure}`);
    const valid = (s: number | undefined) => s !== undefined && s >= 0 && s <= 1;
    if (
      got.scores.length !== candidates.length ||
      !candidates.every((_, i) => valid(got.scores[i]))
    )
      throw new Error(`the reranker "${reranker.model}" did not score every candidate in [0, 1]`);
    // A stable sort: equal scores keep the order the candidates were sent in.
    return candidates
      .map((c, i) => [c.id, got.scores[i] ?? 0] as const)
      .sort((a, b) => b[1] - a[1]);
  });
}

/**
 * The reranker's order blended with the page's own (the reranker's `blend`, else `settings.rerank.blend`), or the
 * page's own where there is no reranker or it failed. Handed the page outright, a reranker promotes look-alikes missing the query's exact token.
 */
export async function rerankedDocuments<T extends Ranked>(
  ranked: T[],
  loose: readonly AskRow[],
  ask: { query: string; reranker: Reranker | null; feed?: DocumentFeed },
): Promise<Reranked<T>> {
  const { query } = ask;
  if (!ask.reranker) return { order: ranked, relevance: null, degraded: [] };
  const { window, passageChars, blend: stated } = settings().rerank;
  const head = ranked.slice(0, window);
  const whole = await documentTexts(
    head.map(([id]) => id),
    ask.feed,
  );
  const candidates = [
    ...head.map(([id, d]) => ({
      id,
      text: whole.value.get(id) ?? d.best.text.slice(0, passageChars),
    })),
    ...loose.map((e) => ({ id: `loose:${rowKey(e)}`, text: e.text.slice(0, passageChars) })),
  ];
  const asked = await scored(ask.reranker, candidates, query);
  const degraded = [...whole.degraded, ...asked.degraded];
  const scores = asked.value;
  if (!scores) return { order: ranked, relevance: null, degraded };
  const rank = new Map(scores.map(([id], i) => [id, i]));
  const blend = Math.min(1, Math.max(0, ask.reranker.blend ?? stated));
  const blended = new Map<string, number>();
  ranked.forEach(([id], i) => {
    const at = rank.get(id);
    blended.set(id, (1 - blend) / (60 + i + 1) + (at === undefined ? 0 : blend / (60 + at + 1)));
  });
  const order = [...ranked].sort((a, b) => (blended.get(b[0]) ?? 0) - (blended.get(a[0]) ?? 0));
  return { order, relevance: new Map(scores), degraded };
}
