/**
 * WHO GENERATED A SOURCE, AND FOR WHOM: the agent's name (as the deployment names it, null when unknown) and
 * the person it wrote as — the display name of whoever the version was saved for, null once they are gone.
 * Never the person alone: an agent's file is labelled as generated on their behalf everywhere it is shown.
 */
export type GeneratedBy = { agent: string | null; onBehalfOf: string | null };
/** Shared, serializable provenance contracts. A version is an ingest event, not a chunk. */
export type SourceSummary = {
  id: string;
  versionId: string;
  app: string;
  title: string;
  kind: string;
  author: string | null;
  location: string | null;
  url: string | null;
  sourceUpdatedAt: string;
  datePrecision?: "day" | "month" | "year" | "unknown"; // how much of the date it knew; absent is an instant
  indexedAt: string;
  metadataStatus: "native" | "legacy";
  /**
   * WHICH ORIGINAL this is a copy of — opaque, stable, the same on every copy
   * of one message however many connections delivered it (keyed by the build
   * that groups copies). Two summaries with one `origin` are one source to
   * show and one to count; absent where the source carries no verified
   * identity, and such a source is its own original. Never a fence input:
   * it is read off rows the viewer may already read.
   */
  origin?: string;
  /**
   * Which series this is an item of: opaque, the same for every item of the series and every copy, from the key the
   * build's writer gave the record. Never a title: two items that share a name are two series. Absent where the record
   * has no series. Never a fence input.
   */
  series?: string;
  /**
   * When the item happens or happened, as the build reads it: an item's card shows this and a series orders by it;
   * `sourceUpdatedAt` is when the record last changed. Absent where the item has no such time.
   */
  occursAt?: string;
  /** The item took place, as the build reads it: it has notes or a record of what happened. */
  held?: true;
  /**
   * An AI agent wrote it and saved it for a person (`presentation.document.via: "agent"`).
   * Every card that shows the source says so; it is searchable and citable as that, and never a
   * fact the knowledge core holds. Absent means a person's source.
   */
  generated?: true;
  /**
   * For an AGENT's source, which agent and on whose behalf, from `presentation.document.agent` and
   * `onBehalfOf`. Absent on a source read before those were stamped: it is still `generated`, labelled
   * "Written by an AI agent".
   */
  generatedBy?: GeneratedBy;
  /**
   * This version's text reads like instructions to a model: the marker's name, never its words. A reader —
   * a person, the assistant or an external agent — quotes it and never follows it.
   */
  instructionLike?: { marker: string };
  /**
   * WHICH CONNECTION delivered its current revision (`event_log.connection_id`). An id, never a name: a client names it
   * from the connections the viewer may see (`GET /v1/me/connections`), so two of one app can be told apart without a
   * name reaching anyone it should not. Absent where the connection is gone or never recorded.
   */
  connectionId?: string;
};
export type SourceSearch = {
  sources: (SourceSummary & {
    excerpt: string;
    match?: "keyword" | "semantic" | "both";
    /**
     * The OTHER readable copies of this original — the same message delivered
     * by another connection the viewer can also read. A listing shows one
     * card per original and names its accessible paths here; a copy the viewer
     * cannot read is never listed and never counted.
     */
    copies?: SourceSummary[];
    /**
     * The other items of this one's series: a page lists one result per series, and names here the other readable
     * items of its `series`, newest first. Only readable ones, never counted otherwise.
     */
    occurrences?: SourceSummary[];
    /** More readable occurrences exist than `occurrences` names (`SERIES_MEMBERS_MAX` per lead): its counts are "at least". */
    occurrencesBounded?: true;
  })[];
  /** Readable sources matching the search — exact, or `SOURCE_COUNT_CAP` when `totalBounded`. */
  total: number;
  /** `total` is a lower bound: counting stopped at `SOURCE_COUNT_CAP`. */
  totalBounded?: boolean;
  /** Counts by app AND connection: two connections of one app are two facets (`connectionId`, null when unrecorded). */
  facets: { app: string; connectionId?: string | null; count: number }[];
  /** Every facet count is a lower bound: counted over the newest `SOURCE_COUNT_CAP` readable sources. */
  facetsBounded?: boolean;
  /** Asked with `facets=skip`: none were counted, and the client keeps the ones it had (`facets` is empty). */
  facetsSkipped?: true;
  offset: number;
  hasMore: boolean;
  retrieval?: "hybrid" | "keyword" | "recent";
  sort?: "relevance" | "newest" | "oldest";
  semanticUnavailable?: boolean;
  /** The keyword index did not answer a listing with words: it is empty because nothing was asked, not because nothing matched. */
  keywordUnavailable?: true;
};
