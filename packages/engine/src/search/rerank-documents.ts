import type { Reranker, Viewer } from "@louvain/engine-core";
import type { Settings } from "../config/settings.js";
import type { ReadContext } from "../read/fence.js";
import { passages } from "../read/passages/index.js";
import { type Attempted, attempt } from "./degraded.js";
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
  { feed: fed, documentChars: maxChars }: Settings["rerank"],
): Promise<Attempted<Map<string, string>>> {
  if (!feed || fed !== "document" || ids.length === 0) return { value: new Map(), degraded: [] };
  return attempt("rerank:document_text", new Map<string, string>(), () =>
    passages.asDocuments(feed.context, feed.viewer, {
      ids: ids,
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
 * The reranker's order blended with the page's own (the reranker's `blend`, else the engine's `tuning.blend`), or the
 * page's own where there is no reranker or it failed. Handed the page outright, a reranker promotes look-alikes missing the query's exact token.
 */
/** What a rerank is asked with: the query, the reranker, where a whole document is read, and the engine's tuning. */
type RerankAsk = {
  query: string;
  reranker: Reranker | null;
  feed?: DocumentFeed;
  tuning: Settings["rerank"];
};

export async function rerankedDocuments<T extends Ranked>(
  ranked: T[],
  loose: readonly AskRow[],
  ask: RerankAsk,
): Promise<Reranked<T>> {
  const { query, tuning } = ask;
  if (!ask.reranker) return { order: ranked, relevance: null, degraded: [] };
  const { window, passageChars, blend: stated } = tuning;
  const head = ranked.slice(0, window);
  const whole = await documentTexts(
    head.map(([id]) => id),
    ask.feed,
    tuning,
  );
  const got = await rerankedRows(ranked, {
    query,
    reranker: ask.reranker,
    blend: ask.reranker.blend ?? stated,
    idOf: ([id]) => id,
    textOf: ([id, d]) => whole.value.get(id) ?? d.best.text.slice(0, passageChars),
    scored: window,
    beside: loose.map((e) => ({ id: `loose:${rowKey(e)}`, text: e.text.slice(0, passageChars) })),
  });
  return {
    order: got.order,
    relevance: got.relevance,
    degraded: [...whole.degraded, ...got.degraded],
  };
}

/** What a reranked order is asked with: which rows the reranker reads, and how each is named and told. */
type RowsAsk<T> = {
  query: string;
  reranker: Reranker | null;
  /** The reranker's share of the order, 0 to 1 (1: its order alone). */
  blend: number;
  idOf: (row: T) => string;
  textOf: (row: T) => string;
  /** How many of the rows, from the first, the reranker reads; the rest keep only their own share. All, left out. */
  scored?: number;
  /** Candidates scored beside the rows that are not themselves ordered (a page's loose rows). */
  beside?: readonly { id: string; text: string }[];
};

/**
 * Rows reordered by the search's reranker, one rule for every caller: a search's documents above, and a listing's head
 * (the Library's Best match), over rows a fenced read already admitted, so it reorders what
 * the reader may read and adds nothing. Scored by `scored` (every candidate in [0, 1], else failed and named
 * `rerank:documents`), then each row's reciprocal rank in its own order at `1 - blend` plus its reciprocal rank in the
 * reranker's at `blend`; a row the reranker did not score keeps only its own share. Stable for equal scores. Without a
 * reranker, or when it failed, the order is the rows' own and `relevance` is null.
 */
export async function rerankedRows<T>(rows: readonly T[], ask: RowsAsk<T>): Promise<Reranked<T>> {
  if (!ask.reranker || rows.length === 0)
    return { order: [...rows], relevance: null, degraded: [] };
  const read = rows.slice(0, ask.scored ?? rows.length);
  const candidates = [
    ...read.map((row) => ({ id: ask.idOf(row), text: ask.textOf(row) })),
    ...(ask.beside ?? []),
  ];
  const asked = await scored(ask.reranker, candidates, ask.query);
  if (!asked.value) return { order: [...rows], relevance: null, degraded: asked.degraded };
  const rank = new Map(asked.value.map(([id], i) => [id, i]));
  const blend = Math.min(1, Math.max(0, ask.blend));
  const blended = new Map<string, number>();
  rows.forEach((row, i) => {
    const at = rank.get(ask.idOf(row));
    blended.set(
      ask.idOf(row),
      (1 - blend) / (60 + i + 1) + (at === undefined ? 0 : blend / (60 + at + 1)),
    );
  });
  const order = [...rows].sort(
    (a, b) => (blended.get(ask.idOf(b)) ?? 0) - (blended.get(ask.idOf(a)) ?? 0),
  );
  return { order, relevance: new Map(asked.value), degraded: asked.degraded };
}
