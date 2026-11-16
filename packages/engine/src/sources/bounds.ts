import { SOURCE_COUNT_CAP } from "@louvain/engine-core";

/**
 * A listing's counts are bounded, not estimated.
 *
 * A total and its facets are reads over the readable set — existence is
 * visibility — so every row is fenced before it is counted, and an exact
 * count therefore walks every readable row, on every page a listing shows,
 * before a word is typed. So the walk stops. The count query asks for one row more
 * than the cap; seeing it means "more than the cap", and the figure reported
 * is the cap itself with `totalBounded` set. The facet query counts the newest
 * `SOURCE_COUNT_CAP` readable sources by app; when the walk filled the cap
 * every facet is a lower bound and `facetsBounded` says so. Neither is an
 * estimate: a bounded count is a true statement about at least that many rows,
 * where a sampled or planner-estimated one is a guess dressed as a figure.
 */
export function boundedTotal(counted: number): { total: number; totalBounded: boolean } {
  return counted > SOURCE_COUNT_CAP
    ? { total: SOURCE_COUNT_CAP, totalBounded: true }
    : { total: counted, totalBounded: false };
}

export function boundedFacets<T extends { count: number }>(
  facets: T[],
): { facets: T[]; facetsBounded: boolean } {
  const counted = facets.reduce((sum, f) => sum + f.count, 0);
  return { facets, facetsBounded: counted >= SOURCE_COUNT_CAP };
}

/** `limit` for the count query: one past the cap is how "more than the cap" is observed. */
export const COUNT_LIMIT = SOURCE_COUNT_CAP + 1;
/** `limit` for the facet walk and the relevance candidate set. */
export const WALK_LIMIT = SOURCE_COUNT_CAP;

/**
 * A reader who reads almost nothing is listed from what they read, not from the date index.
 *
 * The listing walks the scope's date index and stops at the page, which is right while the
 * reader's documents are dense among the newest. The planner estimates that density from how many containers the
 * reader holds, so a reader of many near-empty containers (single files shared with them one by one) looks dense and
 * walks the whole scope for a page of matches that are not there, while the same reader listed from its own
 * documents is found and paged at once.
 *
 * So the search first reads, bounded, what the reader's containers hold: at most `REACH_EVENTS` events, each mapped
 * to its current document. If that EXHAUSTS the containers and finds at most `REACH_DOCS` documents, every listing
 * statement is narrowed to those ids (`d.id = any(…)`, an array the planner counts exactly) and the date walk is
 * never tried. Past either bound the reader is dense enough that the walk is the cheaper read. The fence is
 * untouched: the ids only narrow what it is asked about.
 */
export const REACH_EVENTS = 5_000;
export const REACH_DOCS = 1_000;

/** A read that `count: "skip"` (or `facets: "skip"`) leaves out: nothing, without asking the database. */
export function unlessSkipped<T>(skip: "skip" | undefined, read: () => Promise<T[]>): Promise<T[]> {
  return skip === "skip" ? Promise.resolve([]) : read();
}

/** The most rows one listing page holds (`listingPage`'s default): a skipped count says "more" when the page was full. */
const LISTING_PAGE = 24;

/**
 * A listing's total and whether more follows. With the count read it is `boundedTotal`; with `count: "skip"` (the arrived read,
 * `notices=hide`) the total is what the pages so far read — a floor, said so — and more follows when the page was full.
 */
export function pageTotal(
  input: { count?: "skip" | undefined; offset: number },
  counted: { count: number }[],
  rows: number,
): { total: number; totalBounded: boolean; hasMore: boolean } {
  if (input.count === "skip")
    return { total: input.offset + rows, totalBounded: true, hasMore: rows >= LISTING_PAGE };
  const { total, totalBounded } = boundedTotal(counted[0]?.count ?? 0);
  return { total, totalBounded, hasMore: input.offset + rows < total };
}
