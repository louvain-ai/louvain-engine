import type { Reader } from "../fence.js";
import type { AddedFilters } from "../listing/filter-seam.js";
import type { PassageFilters } from "./types.js";

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
  /** A hit shown by its best-matching passage, not its first (`../keyword/rows.ts` `bestOf`). */
  bestPassage: boolean;
  /** Recall bounded to one pass: a build's passes run their narrow pass alone, unless none can be built. */
  boundedRecall: boolean;
  /** A decaying read's re-sort, applied to each ranking on its own: the sidecar's, the narrow pass, the wide. */
  decay: ((rows: Row[]) => Row[]) | null;
  /** The page a decaying read returns (`limit` is then what it asked each pass for); the limit otherwise. */
  page: number;
};
