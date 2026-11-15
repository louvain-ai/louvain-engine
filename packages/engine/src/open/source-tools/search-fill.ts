import type { SourceSummary, Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../kg/read/fence.js";
import type { Neighbour } from "../../kg/read/passages.js";
import { searchSources } from "../../sources/read-search.js";
import type { SearchAsked } from "./search-asked.js";
import { idPrefix, type SearchCursor } from "./search-paging.js";
import { type ClientNarrow, clientListing } from "./tool-helpers.js";

/**
 * The listing a ranked page is filled from past its head: the same fence and the search's own filters, in the
 * listing's own order, so a source with no passages is still found by its title and each page resumes where it stopped.
 */

/** A document on the ranked page: the record that matched, its source's summary, the excerpt, a chat's neighbours. */
export type Shown = {
  recordId: string;
  summary: SourceSummary;
  excerpt: string;
  conversation?: Neighbour[];
};

/** Where one listing page is read: its mode and offset, inside which containers, for which client. */
type ListingAt = {
  mode: "hybrid" | "keyword";
  offset: number;
  containers: string[] | undefined;
  client: ClientNarrow | undefined;
};

/** One page of the listing the ranked head is filled from, read with the search's own filters. */
export function listingPage(
  context: ReadContext,
  owner: Viewer,
  asked: SearchAsked,
  at: ListingAt,
) {
  return searchSources(context, owner, {
    q: asked.query,
    mode: at.mode,
    sort: "relevance",
    app: asked.app,
    after: asked.after,
    before: asked.before,
    offset: at.offset,
    ...(at.containers ? { containers: at.containers } : {}),
    ...clientListing(at.client),
  });
}

export type Listed = Awaited<ReturnType<typeof listingPage>>;

export const fromListing = (s: Listed["sources"][number]): Shown => ({
  recordId: s.versionId,
  summary: s,
  excerpt: s.excerpt,
});

/** Past the head: the listing's position, the head's ids it skips, and whether the head matched (`m`). */
export const listingCursor = (
  k: string,
  past: { j: number; headIds: string[]; matched: boolean },
): SearchCursor => ({
  v: 1,
  k,
  p: "listing",
  j: past.j,
  r: past.headIds.map(idPrefix),
  ...(past.matched ? { m: true as const } : {}),
});
