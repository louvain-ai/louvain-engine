/**
 * How far a source listing COUNTS before it stops. A total and its facets are
 * reads over the readable set, so they are fenced row by row, and an exact
 * count would walk every readable row on every page load. Past this many rows the
 * count is reported as this figure with `totalBounded` set, and a facet's
 * count is the number among the newest `SOURCE_COUNT_CAP` readable sources
 * with `facetsBounded` set: "at least", never a guess.
 */
export const SOURCE_COUNT_CAP = 10_000;
