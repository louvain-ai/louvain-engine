import type { AddedFilters } from "../../sources/filter-seam.js";
import type { AsOf, Embedder, Evidence } from "./context.js";
import type { Reader } from "./fence.js";
import type { RecordFilters } from "./filters.js";

/** The types the passage reads share: what they take, what they return, and the row a leg reads. */

export type PassageFilters = RecordFilters & {
  /** Bi-temporal ceiling, as recall's: nothing said after this. Default now. */
  asOf?: AsOf;
  /**
   * Narrows to these containers: intersected with the readable set, never added to it, as `records.window` does. A
   * neighbour-document hop searches again in the containers the first page came from. A container the viewer cannot
   * read narrows to nothing, so it can only cost rows; an empty intersection returns an empty page.
   */
  containers?: string[];
  /** Only these records: a reader's fetch round, or a brief's own sources. */
  recordIds?: string[];
  /**
   * A recency FLOOR and CEILING, as recall's `since`/`until`: they bound the recency leg and the window,
   * never what is true. Equivalent to `window`, kept under recall's names so a ported caller reads the same.
   */
  since?: string;
  until?: string;
  /** Only passages that state a figure — recall's quantity leg, for a question that asks for one. */
  digits?: boolean;
};

export type PassageSearchOptions = {
  mode: "vector" | "keyword" | "hybrid";
  filters?: PassageFilters;
  limit?: number;
  /** `fast`'s bound (`AskSettings.recall`): the narrow lexical pass alone. */
  bounded?: boolean;
  /** Locate each passage in its record's text (one fenced read of the hits' records). Default true. */
  spans?: boolean;
  /**
   * Newest first, not nearest. Similarity has no clock: "the latest offer" ranked by relevance returns older offers
   * just as similar. With `order: "recent"` the legs keep their filters and order by when the passage was said, and
   * with no query (`recencyOnly`) it is the newest readable passages.
   */
  order?: "relevance" | "recent";
  /**
   * By time alone: with `order: "recent"`, the newest passages that share a word with the query, without the relevance
   * legs narrowing which may enter, since those keep long rows nearest the words over short newer ones.
   */
  timeAlone?: boolean;
  /** A keyword hit shown by its best-matching passage; `false`, by its first. Absent, the best (the default). */
  bestPassage?: boolean;
  /**
   * The topic is its rare words (with `timeAlone`). Words are weighed by how many readable passages hold them, inside
   * this viewer's fence (`topicTerms`): a word in more than `GENERIC_SHARE` of them is dropped, and of the rest only
   * those within `TOPIC_SPREAD` of the rarest are kept. No word left, no row. Counted, never listed.
   */
  rareTerms?: boolean;
  embedder?: Embedder;
} & PassageDecay;

/**
 * Age lowers relevance inside each leg (`decay.ts` `decayed`), measured from `decayFrom` (ms), for a question not about
 * the past, at the caller's scale (`decayDays`) and floor (`decayFloor`). Ranking only: what is read, quoted and fenced
 * is the same either way. All three or none.
 */
type PassageDecay =
  | { decayFrom?: undefined; decayDays?: undefined; decayFloor?: undefined }
  | { decayFrom: number; decayDays: number; decayFloor: number };

export type PassageHit = Evidence & {
  kind: "passage";
  passageId: string;
  /** Chunk order within the record. */
  seq: number;
  score: number;
  legs: ("vector" | "keyword" | "recent")[];
};

/** A passage read by id: the evidence, without a score — nothing ranked it. */
export type PassageRead = Omit<PassageHit, "score" | "legs">;

export type PassageSearch = {
  hits: PassageHit[];
  degraded: string[];
  /** The page filled its limit: there may be more (recall's `truncated`). */
  bounded: boolean;
};

export type Row = {
  id: string;
  event_id: string;
  seq: number;
  text: string;
  container: string;
  author: string | null;
  occurred_at: Date;
  /** The leg's own relevance, higher nearer (1 − cosine distance, `ts_rank`, a BM25 score): what `decayed` scales. */
  score?: number;
};

/** What a windowed vector read did: scanned, it may have stopped short, and the page says "there may be more". */
export type WindowRead = { scanned: boolean };

/**
 * What every passage leg reads: the fenced set and its filters, the search as typed, how many rows the leg asks for,
 * whether a passage's context is read beside it, and where the leg says what it could not do. One search's legs push
 * to the same `degraded`. Each leg adds what only it reads.
 */
export type PassageLegRead = {
  fence: Reader;
  filters: PassageFilters;
  /** The build's filters after the fence, which a record filter reads (`ReadHooks.filters`). */
  added: AddedFilters;
  query: string;
  limit: number;
  contextual: boolean;
  degraded: string[];
};

/** A keyword leg's read: the passage read, and how its passes are paged. */
export type KeywordLegRead = PassageLegRead & {
  /** A hit shown by its best-matching passage, not its first (`keyword/rows.ts` `bestOf`). */
  bestPassage: boolean;
  /** Recall bounded to one pass: a build's passes run their narrow pass alone, unless none can be built. */
  boundedRecall: boolean;
  /** A decaying read's re-sort, applied to each ranking on its own: the sidecar's, the narrow pass, the wide. */
  decay: ((rows: Row[]) => Row[]) | null;
  /** The page a decaying read returns (`limit` is then what it asked each pass for); the limit otherwise. */
  page: number;
};
