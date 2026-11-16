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
