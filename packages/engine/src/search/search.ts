import type { Reranker, Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../read/fence.js";
import { documentRanks } from "../read/passages/leg-ranks.js";
import { records } from "../read/records/index.js";
import { withConversations } from "./conversation.js";
import { searchHeadDepth, withoutShown } from "./depth.js";
import type { DocumentSearch, SearchedDocument, SearchOptions } from "./document.js";
import { AGENT_SEARCH_CHUNK_BONUS, documentOrder } from "./document-order.js";
import { pageOf } from "./evidence.js";
import { excerptOf } from "./excerpt.js";
import { oneOfEachOriginal } from "./original.js";
import { poolDepth } from "./pool-depth.js";
import type { SearchPool, SearchWith } from "./pool-types.js";
import { questionFor } from "./question.js";
import { rerankQueryOf } from "./rerank-query.js";
import { type Staged, stage, whole } from "./stage.js";
import { titledDocuments, withTitled } from "./titled.js";

/** One search: who reads, what they asked, and how. */
export type SearchRequest = {
  context: ReadContext;
  reader: Viewer;
  query: string;
  options: SearchOptions;
};

/**
 * A search, stage by stage. Each stage is one line here and one function elsewhere, timed under its name, returning what
 * it found and what it could not do, so the order IS this function and the page's `degraded` is theirs, in order:
 *
 *   legs          the caller's pool: the legs under the reader's fence, fused (`SearchWith.pool`)
 *   titled        documents whose title the search names, read beside the legs, ADDED in fixed places
 *   documents     passages grouped into documents by their best passage, reranked when a reranker is configured
 *   originals     two readable copies of one file are one hit, the best-ranked copy leading
 *   named         each document's summary through the listing's own fenced reader
 *   (unshown)     documents the caller already showed left out, the page read further down the same order
 *   conversation  the messages beside a chat hit
 *
 * No stage builds a WHERE clause: every read is a fenced primitive in `kg/read`. What an agent writes is a query, not a
 * question, so there is no plan: no entities, no recency cue, no model call.
 */
export async function search(request: SearchRequest, using: SearchWith): Promise<DocumentSearch> {
  const { options } = request;
  const limit = Math.max(1, Math.min(searchHeadDepth(), Math.floor(options.limit)));
  const question = questionFor(request, using);
  const titling = stage("titled", () => titledDocuments(request));
  const legs = await stage("legs", () =>
    legsOf(request, { question, depth: poolDepth(limit), using }),
  );
  const documents = await stage("documents", () =>
    documentsOf(request, question, { found: legs.value, using }),
  );
  const titled = await titling;
  const placed = withTitled(documents.value.order, titled.value, limit);
  const want = limit + placed.added;
  // Room for documents already shown: a longer prefix of the same order, never a deeper pool (which would reorder it).
  const originals = await stage("originals", () =>
    whole(
      oneOfEachOriginal(request.context, request.reader, {
        order: placed.order,
        want: want + (options.exclude?.size ?? 0),
      }),
    ),
  );
  const read = await stage("named", () => whole(named(request, originals.value.chosen)));
  const unshown = withoutShown(shownAs(read.value, documents.value.origin, documents.value), {
    exclude: options.exclude,
    want,
    further: originals.value.more,
  });
  const conversation = await stage("conversation", () =>
    conversationOf(request, unshown.kept, using),
  );
  return pageFrom(unshown, {
    staged: [legs, documents, titled, conversation],
    reranker: documents.value.reranker,
  });
}

/**
 * The page: the documents kept, whether more follow (counted in originals: a run of copies past the page is not more),
 * every stage's degradations in stage order, and the reranker that ordered it.
 */
function pageFrom(
  unshown: { kept: SearchedDocument[]; more: boolean },
  {
    staged,
    reranker,
  }: {
    staged: { degraded: readonly string[] }[];
    reranker: Parameters<typeof rerankedBy>[0] | null | undefined;
  },
): DocumentSearch {
  return {
    documents: unshown.kept,
    hasMore: unshown.more,
    degraded: [...new Set(staged.flatMap((s) => s.degraded))],
    ...(reranker ? { reranked: rerankedBy(reranker) } : {}),
  };
}

/** The caller's pool for the query, and the question's when it is searched too. */
async function legsOf(
  { context, reader, query, options }: SearchRequest,
  { question, depth, using }: { question: string | null; depth: number; using: SearchWith },
): Promise<Staged<Awaited<ReturnType<SearchPool>>>> {
  const found = await using.pool(context, reader, { query, question, depth, opts: options });
  return { value: found, degraded: found.degraded };
}

/** A chat hit's conversation, in place on the documents; what the read could not do. */
async function conversationOf(
  { context, reader, options }: SearchRequest,
  documents: SearchedDocument[],
  using: SearchWith,
): Promise<Staged<null>> {
  return {
    value: null,
    degraded: await withConversations(context, reader, {
      documents,
      opts: options,
      told: using.conversation,
    }),
  };
}

/**
 * The pool's passages grouped into documents, each ranked by its best evidence and reordered by the cross-encoder when
 * one is configured (`documentOrder`, the reader's own whole-document order). `pageOf` keeps each hit's own evidence
 * object as the row's origin, where a page shown as written finds its passage's span.
 */
async function documentsOf(
  { context, reader, query, options }: SearchRequest,
  question: string | null,
  legs: { found: Awaited<ReturnType<SearchPool>>; using: SearchWith },
) {
  const { found, using } = legs;
  const { reranker } = using.pool;
  const page = pageOf(found.found);
  const { degraded, ...ordered } = await documentOrder({
    rows: page.rows,
    pool: page.rows,
    query: rerankQueryOf(query, question, options.rerankWith),
    settings: { rerank: options.rerank },
    chunkBonus: AGENT_SEARCH_CHUNK_BONUS,
    tuning: using.settings.rerank,
    feed: { context, viewer: reader, ...(options.asOf ? { asOf: options.asOf } : {}) },
    ...(reranker !== undefined ? { reranker } : {}),
  });
  return {
    value: { ...ordered, origin: page.origin, ranks: documentRanks(found.found) },
    degraded,
  };
}

/**
 * Each named document once, shown by the passage that ranked it, with where that passage sits in its record's text when
 * the read found it there. A record with no source document has no title to show and nothing `louvain_read_source`
 * opens by document.
 */
function shownAs(
  rows: Awaited<ReturnType<typeof named>>,
  origin: ReadonlyMap<string, { span?: { start: number; end: number } | null }>,
  facts: {
    relevance: ReadonlyMap<string, number> | null;
    ranks: ReadonlyMap<string, NonNullable<SearchedDocument["ranks"]>>;
  },
): SearchedDocument[] {
  const read: SearchedDocument[] = [];
  const seen = new Set<string>();
  for (const { recordId, summary, ranked } of rows) {
    if (!summary || seen.has(summary.id)) continue;
    seen.add(summary.id);
    const span = ranked.best.tier === "passage" ? origin.get(ranked.best.key)?.span : null;
    const judged = facts.relevance?.get(recordId);
    const ranks = facts.ranks.get(recordId);
    read.push({
      recordId,
      summary,
      excerpt: excerptOf(ranked.best),
      score: ranked.score,
      ...(judged === undefined ? {} : { relevance: judged }),
      ...(ranks ? { ranks } : {}),
      ...(span ? { span: { start: span.start, end: span.end } } : {}),
    });
  }
  return read;
}

/** The reranker that scored a search, as a page reports it: its model, and its measured cut-offs when it has any. */
const rerankedBy = (r: Reranker) => ({
  model: r.model,
  ...(r.cutoffs ? { cutoffs: r.cutoffs } : {}),
});

type Ranked = Awaited<ReturnType<typeof documentOrder>>["order"][number][1];

/** Each chosen document with its summary, read through the listing's own fenced reader. */
async function named(
  { context, reader }: SearchRequest,
  chosen: readonly (readonly [string, Ranked])[],
) {
  const { summaries } = await records.summaries(
    context,
    reader,
    chosen.map(([recordId]) => recordId),
  );
  const by = new Map(summaries.map((s) => [s.recordId, s]));
  return chosen.map(([recordId, ranked]) => ({ recordId, summary: by.get(recordId), ranked }));
}
