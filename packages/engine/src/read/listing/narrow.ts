/*
 * A narrowing of a listing (`SearchInput.narrow`): data only. What it keeps is the predicate an application binds
 * (`filter-seam.ts` `narrowed`), AND-ed after the fence, so it only removes rows; the open build keeps nothing.
 */

/** What a client or a project narrows a listing to (`SearchInput.narrow`). */
export type Narrow = {
  include: readonly string[];
  exclude: readonly string[];
  added: readonly string[];
  removed: readonly string[];
  /**
   * Upload collections whose documents are in (a project's own collection), as `source_document.workspace`:
   * ranked with the included identifiers, so an excluded one or a person's removal still keeps a document out. A
   * client's narrow has none.
   */
  collections: readonly string[];
  /**
   * Upload files that are in (a project's folder rules): their ids (`source_document.native_id`) and the
   * collections' workspaces they are filed in, ranked as `collections` is. A client's narrow has none.
   */
  folderFiles: { workspaces: readonly string[]; ids: readonly string[] };
  /**
   * The current records a project's keyword and channel rules found, inside the reader's fence and capped
   * (`keywordRecords`, `channelRecords`): ranked as `collections` is. Resolved before the listing, so the listing
   * tests a bounded set and never matches a phrase or walks a channel row by row. A client's narrow has none.
   */
  ruledRecords: readonly string[];
  /**
   * A project's keyword phrases: never a filter (`ruledRecords` is), only so a listing with no words typed can
   * quote the passage of each document that says one (the host's `passageQuotes`). A client's narrow has none.
   */
  keywords?: readonly string[];
  /**
   * Of `ruledRecords`, those a keyword rule found, and those a channel rule did: a project turn reads a long
   * record that only a keyword brought in at the passages that say it.
   */
  keywordRecords?: readonly string[];
  otherRuledRecords?: readonly string[];
  /** Its identifiers were capped: the total is "at least" (`SourceSearch.totalBounded`). */
  bounded: boolean;
};
