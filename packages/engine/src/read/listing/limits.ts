import { SOURCE_COUNT_CAP } from "@louvain/engine-core";

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
