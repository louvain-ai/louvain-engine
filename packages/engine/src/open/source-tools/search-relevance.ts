import type { RelevanceCutoffs, Viewer } from "@louvain/engine-core";
import { searchRelevanceSetting } from "../../config/engine-switches.js";
import { embedderOf } from "../../embedder.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import { heldWords, literalsOf, relevanceOf, wordsOf } from "../../kg/read/relevance.js";
import { spanTexts } from "../../kg/read/span-texts.js";
import { excerptOf } from "../../search/excerpt.js";
import { openPresentation } from "./presentation-seam.js";
import { exactFirst, type Narrowing, type Placed } from "./search-exact.js";
import { compactHit, fullHit, type ShownHit } from "./search-hits.js";
import { type By, matchedBy, withFound } from "./search-reranked.js";

/**
 * A SEARCH SAYS WHEN NOTHING MATCHES. A ranked list always has a first place, so without this a word that is in no
 * document ("highfield") came back with every document as a result. Each document on the page is a MATCH when it holds
 * one of the search's content words (or a figure it names, in any of its written forms), or when its nearest passage
 * is at least the embedder's floor in meaning. The rest are shown apart, as loosely related, and when nothing matches
 * the page says so in a sentence an agent can act on.
 *
 * THE FLOOR IS THE EMBEDDER'S, MEASURED, never one constant: cosine similarity means different things for different
 * models. A model with no measured floor decides by words alone and says nothing about meaning it cannot stand behind.
 * A floor sits between the nearest passages of questions the documents answer and those of searches they do not.
 */
const MEANING_FLOORS: Readonly<Record<string, number>> = { "Xenova/bge-base-en-v1.5": 0.57 };

/**
 * A DOCUMENT MATCHES BY MEANING ONLY WHEN THE SEARCH HAS WORDS TO MEAN SOMETHING: a string neither the documents nor the
 * language model knows as a word (a GUID, a keyboard run) lands near some document by chance, above the floor. A word
 * this embedder's tokeniser splits into this many pieces or more, and that no readable passage holds, carries no
 * meaning; with no word left, meaning is not measured. Recorded per model like the floor; a model with none recorded
 * measures the whole search.
 */
const SHATTERED_AT: Readonly<Record<string, number>> = { "Xenova/bge-base-en-v1.5": 5 };

/**
 * The text the search's meaning is measured on: the search, less each word the tokeniser shatters
 * (`SHATTERED_AT`) that no readable passage holds; null when no word is left. The pieces are the sidecar's own count
 * (`/count`), less what an empty text counts (the model's markers); a count it cannot give measures the whole search.
 */
async function meaningOf(
  context: ReadContext,
  owner: Viewer,
  query: string,
): Promise<string | null> {
  if (namesOnly(query)) return null;
  const cut = SHATTERED_AT[embedderOf(context).settings().model];
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (cut === undefined || words.length === 0) return query;
  let pieces: number[];
  try {
    const [markers = 0, ...counts] = await embedderOf(context).remoteTokenCounts(["", ...words]);
    pieces = counts.map((n) => n - markers);
  } catch {
    // swallowed: without the tokeniser's count the search is measured whole, as before this rule.
    return query;
  }
  const shattered = words.filter((_, at) => (pieces[at] ?? 0) >= cut);
  if (shattered.length === 0) return query;
  const held = await heldWords(context, owner, shattered);
  const kept = words.filter((w, at) => (pieces[at] ?? 0) < cut || held.has(w));
  return kept.length > 0 ? kept.join(" ") : null;
}

/**
 * A SEARCH THAT ONLY NAMES THINGS IS NOT MEASURED BY MEANING (rule 6): every word of it an identifier or a figure
 * ("SUP-1000", "2400"). To the embedder one ticket key is near every other, so look-alikes outranked the right one; the
 * page is the document it names, then the documents holding what it names, then nothing.
 */
const namesOnly = (query: string): boolean =>
  literalsOf(query).length > 0 && !/\p{L}/u.test(wordsOf(query));

/** A search the holders' page answers (`search-holders.ts`): one that only names things, where this page splits. */
export const namesOnlySearch = (
  context: ReadContext,
  query: string,
  mode: "hybrid" | "keyword",
): boolean => mode !== "keyword" && relevanceSplit(context) && namesOnly(query);

/** Which of these documents hold what the search names: by its words or literals, never by meaning. */
export async function holdersAmong(
  context: ReadContext,
  owner: Viewer,
  query: string,
  docs: readonly { recordId: string }[],
): Promise<Map<string, Matched>> {
  const found = await matchesOf(context, owner, query, docs, null);
  return new Map([...found].filter(([, m]) => isMatch(context, m)));
}

/**
 * How a document matches: its words, its meaning, `exact` when it IS what the search names (`search-exact.ts`), the
 * reranker's `relevance` (0 to 1) when one scored it, its `ranks` in the keyword (`words`) and vector (`meaning`) legs
 * before fusion, and `by`, the strongest reason it matched (`search-reranked.ts`).
 */
export type Matched = {
  words: boolean;
  meaning: number | null;
  exact?: true;
  relevance?: number;
  ranks?: Ranks;
  by?: By;
};
type Ranks = { words: number | null; meaning: number | null };
const NO_MATCH: Matched = { words: false, meaning: null };

/** How each document matches the search, by its record id; one fenced read for all of them. */
async function matchesOf(
  context: ReadContext,
  owner: Viewer,
  query: string,
  docs: readonly { recordId: string }[],
  meaning: string | null,
): Promise<Map<string, Matched>> {
  const found = await relevanceOf(
    context,
    owner,
    query,
    docs.map((d) => d.recordId),
    { meaning },
  );
  return new Map(docs.map((d) => [d.recordId, found.get(d.recordId) ?? NO_MATCH]));
}

/**
 * Why a document matches (`matchedBy`): it IS what the search names, holds its words, the reranker scores it at its
 * cut-off, or its meaning reaches this embedder's measured floor. None of these, it does not match.
 */
const byOf = (context: ReadContext, m: Matched | undefined, cutoffs?: RelevanceCutoffs) =>
  matchedBy(m ?? NO_MATCH, MEANING_FLOORS[embedderOf(context).settings().model], cutoffs);
const isMatch = (context: ReadContext, m: Matched | undefined, cutoffs?: RelevanceCutoffs) =>
  byOf(context, m, cutoffs) !== undefined;

/**
 * A search with nothing to look for: no letter and no digit ("?!"). Its words match nothing and its meaning is noise,
 * so it is refused in a sentence rather than answered with a page of guesses.
 */
export const searchable = (query: string): boolean => /[\p{L}\p{N}]/u.test(query);

/** Said without the search's own words: a page never repeats what was asked, only what was found. */
const NOTHING_MATCHES =
  "Nothing in your documents matches this search: none holds its words or comes close to it in meaning. Any listed under looselyRelated are only the nearest.";
/** When nothing could be measured: no nearest, because nearness was never measured. */
const NOTHING_TO_MEAN =
  "Nothing in your documents matches this search. It holds no word your documents or the language model know, so nothing is close to it in meaning either.";
const NOTHING_NAMED = "Nothing in your documents matches this search: none holds what it names.";
/**
 * The ranked head with its matches first (each group in ranked order), how each document matches, and whether any does
 * (null where the split is off). Decided over the WHOLE head before it is paged, so every page of a search that
 * matched says so, and the loosely related come after the last match.
 */
export type HeadSplit<D> = {
  ordered: D[];
  matches: Map<string, Matched>;
  matched: boolean | null;
  /** What meaning was measured on (`meaningOf`): null when the search had no word to measure it with. */
  meaning?: string | null;
  /** The reranker's measured cut-off when it scored a search measured by meaning: it can add a match, never a page. */
  cutoffs?: RelevanceCutoffs;
};

/**
 * Meaning was not measured (`meaningOf`): there is no nearest, so the page is the matches alone, with no loosely related
 * documents and no page past the head; with no match, the note alone.
 */
export const unmeasured = (split: HeadSplit<unknown> | null): boolean => split?.meaning === null;

/** What a split page measures meaning on (`meaningOf`; none in keyword mode); undefined where the page does not split. */
export const measured = async (
  context: ReadContext,
  owner: Viewer,
  query: string,
  mode: "hybrid" | "keyword",
) =>
  !query || !relevanceSplit(context)
    ? undefined
    : mode === "keyword"
      ? null
      : meaningOf(context, owner, query);

export async function splitHead<D extends Placed & { relevance?: number; ranks?: Ranks }>(
  context: ReadContext,
  owner: Viewer,
  query: string,
  shown: D[],
  mode: "hybrid" | "keyword",
  narrowing: Narrowing & {
    reranked?: { cutoffs?: RelevanceCutoffs } | undefined;
    meaning?: string | null;
  },
): Promise<HeadSplit<D | Placed>> {
  if (!query || !relevanceSplit(context))
    return { ordered: shown, matches: new Map(), matched: null };
  // The documents the search names lead, in a tier of their own (`search-exact.ts`).
  const head = await exactFirst(context, owner, query, shown, narrowing);
  const meaning =
    narrowing.meaning !== undefined
      ? narrowing.meaning
      : ((await measured(context, owner, query, mode)) ?? null);
  const matches = await matchesOf(context, owner, query, head, meaning);
  for (const d of head) matches.set(d.recordId, withFound(matches.get(d.recordId) ?? NO_MATCH, d));
  // A search not measured by meaning (names only, or nothing to mean) is its named documents alone: no score adds one.
  const cutoffs = meaning === null ? undefined : narrowing.reranked?.cutoffs;
  const matching = head.filter((d) => isMatch(context, matches.get(d.recordId), cutoffs));
  const rest =
    meaning === null && mode !== "keyword"
      ? []
      : head.filter((d) => !isMatch(context, matches.get(d.recordId), cutoffs));
  const ordered = [...matching, ...rest];
  return {
    ordered,
    matches,
    matched: matching.length > 0,
    ...(mode === "keyword" ? {} : { meaning }),
    ...(cutoffs ? { cutoffs } : {}),
  };
}

/**
 * THE RANKED PAGE'S HITS: each full or compact by its place, then (where the split is on) told apart into the
 * documents that match the search and the ones only loosely related. Whether the SEARCH matched is the head's, decided
 * before paging (`splitHead`); a document the listing filled in past the head is read here. A container's listing (no
 * query) has nothing to match and is shown whole.
 */
export async function rankedHits<D extends ShownHit>(
  context: ReadContext,
  owner: Viewer,
  query: string,
  shown: readonly D[],
  names: ReadonlyMap<string, string>,
  fullHits: number,
  mode: "hybrid" | "keyword",
  split: HeadSplit<ShownHit> | null,
) {
  const placed = shown.map((d, at) => ({ ...d, full: at < fullHits }));
  const { linkTo } = hooksOf(context).presentation;
  const hitOf = (d: (typeof placed)[number], match?: Matched) => ({
    ...(d.full ? fullHit(d, names, linkTo) : compactHit(d, linkTo)),
    ...(match ? { match } : {}),
  });
  if (!query || !relevanceSplit(context)) return { sources: placed.map((d) => hitOf(d)) };
  if (unmeasured(split) && !split?.matched) {
    const note = namesOnly(query) ? NOTHING_NAMED : NOTHING_TO_MEAN;
    return { sources: [], looselyRelated: [], matched: false, note };
  }
  const unknown = placed.filter((d) => !split?.matches.has(d.recordId));
  const meaning =
    mode === "keyword"
      ? null
      : split?.meaning !== undefined
        ? split.meaning
        : await meaningOf(context, owner, query);
  const filled =
    unknown.length > 0 ? await matchesOf(context, owner, query, unknown, meaning) : new Map();
  const matchOf = (d: (typeof placed)[number]): Matched => {
    const m = split?.matches.get(d.recordId) ?? filled.get(d.recordId) ?? NO_MATCH;
    const by = byOf(context, m, split?.cutoffs);
    return { ...m, ranks: m.ranks ?? { words: null, meaning: null }, ...(by ? { by } : {}) };
  };
  const sources = placed.filter((d) => matchOf(d).by);
  const matched = (split?.matched ?? false) || sources.length > 0;
  const loose = unmeasured(split) ? [] : placed.filter((d) => !matchOf(d).by);
  return {
    sources: sources.map((d) => hitOf(d, matchOf(d))),
    looselyRelated: loose.map((d) => hitOf(d, matchOf(d))),
    matched,
    note: matched || placed.length === 0 ? null : NOTHING_MATCHES,
  };
}

/**
 * THE OPEN PAGE SHOWS AN EXCERPT AS IT WAS WRITTEN. A stored passage is flattened to one line for indexing, so a
 * heading, a list dash or a table bar after its first block read as noise mid-sentence. Where this page splits
 * (`relevanceSplit`), each ranked document's excerpt is cut from its record's own text at the span its passage was
 * located at (`spanTexts`), line breaks intact; a document with no span keeps the flattened excerpt. What is stored,
 * embedded and indexed is unchanged, and a page that does not split keeps the flattened excerpt.
 */
export async function asWritten<
  D extends { recordId: string; excerpt: string; span?: { start: number; end: number } },
>(context: ReadContext, owner: Viewer, documents: readonly D[]): Promise<D[]> {
  if (!relevanceSplit(context)) return [...documents];
  const wanted = documents.flatMap((d) => (d.span ? [{ recordId: d.recordId, span: d.span }] : []));
  const written = await spanTexts(context, owner, wanted);
  return documents.map((d) => {
    const text = written.get(d.recordId);
    return text === undefined ? d : { ...d, excerpt: excerptOf({ text, tier: "passage" }) };
  });
}

/**
 * Whether this page splits matches from loosely related documents (and shows excerpts as written, `asWritten`): as
 * `LOUVAIN_SEARCH_RELEVANCE` says, else by the build: the open build (its own presentation bound) splits, and a build
 * that binds another presentation keeps one ranked list unless the setting asks.
 */
const relevanceSplit = (context: ReadContext): boolean =>
  searchRelevanceSetting() ?? hooksOf(context).presentation === openPresentation;
