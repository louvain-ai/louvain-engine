import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import { searchSources } from "../../read/listing/search.js";
import { instructionLikeField } from "../../store/quarantine.js";
import { type ClientNarrow, clientListing, connectionOf, ToolInputError } from "./arguments.js";
import { datedAs } from "./dated.js";
import type { LinkTo } from "./presentation.js";
import { type SearchAsked, searchAskedOf } from "./search-asked.js";
import { authorOf } from "./search-hits.js";
import { encodeCursor, fillFromListing, type SearchCursor } from "./search-paging.js";

/**
 * The list view: for "every X about Y", every matching source by its title, date, app and author, NEWEST
 * FIRST, in pages of up to 100 — the listing itself (`searchSources`, sort newest), which walks the tenant in page
 * order and stops, so its total is "at least" past its cap. No excerpts: a page is a list to choose from, and each
 * `id` opens with louvain_read_source. The same in every knowledge mode.
 */
export async function listSources(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  page: ListAsked,
) {
  const { cursor } = page;
  if (cursor.p !== "list")
    throw new ToolInputError("That cursor belongs to the ranked view: omit view.");
  const asked = searchAskedOf(args);
  const owner = { orgId: ctx.orgId, principal: ctx.principal };
  const listing: Listing = {
    ...{ context, owner, asked, page },
    ...{
      total: 0,
      totalIsLowerBound: false,
      semanticUnavailable: false,
      keywordUnavailable: false,
    },
  };
  const { fill, ranged } = await rangedWalk(listing, cursor);
  const names = await hooksOf(context).presentation.connectionNames(
    ctx.orgId,
    ctx.principal,
    fill.rows.flatMap((s) => (s.connectionId ? [s.connectionId] : [])),
  );
  return listPage(listing, { cursor, fill, ranged, names });
}

/** The list view's page: how many, inside which containers, from which cursor, for which client. */
type ListAsked = {
  limit: number;
  containers: string[] | undefined;
  cursor: SearchCursor;
  client?: ClientNarrow | undefined;
};

/** One list view's walk, and what its last listing page counted. */
type Listing = {
  context: ReadContext;
  owner: Viewer;
  asked: SearchAsked;
  page: ListAsked;
  total: number;
  totalIsLowerBound: boolean;
  semanticUnavailable: boolean;
  /** The keyword index did not answer the query's words: nothing was searched by them. */
  keywordUnavailable: boolean;
};

type ListCursor = Extract<SearchCursor, { p: "list" }>;
type Walked = Awaited<ReturnType<typeof walk>>;

/** One listing walk: the query's matches, or with `q` empty the date range itself — the same fence and listing. */
function walk(listing: Listing, q: string, from: number) {
  const { context, owner, asked, page } = listing;
  return fillFromListing(
    async (offset) => {
      const got = await searchSources(context, {
        owner,
        input: {
          q,
          mode: asked.mode,
          sort: "newest",
          apps: asked.apps,
          ...(asked.direction ? { direction: asked.direction } : {}),
          after: asked.after,
          before: asked.before,
          offset,
          ...(page.containers ? { containers: page.containers } : {}),
          ...clientListing(page.client),
        },
      });
      listing.total = got.total;
      listing.totalIsLowerBound = got.totalBounded ?? false;
      listing.semanticUnavailable ||= got.semanticUnavailable ?? false;
      listing.keywordUnavailable ||= got.keywordUnavailable ?? false;
      return { rows: got.sources, hasMore: got.hasMore };
    },
    { from, want: page.limit, skip: new Set(), pageSize: 24 },
  );
}

/**
 * Nothing in the range matched, so the range is listed and says so. Decided by the count, never by the query's
 * wording: with a range and no match on the first page, the range itself is listed newest first (`q` empty, the same
 * fence and listing) under `queryMatched: false`, and a cursor carries that on (`w`).
 */
async function rangedWalk(listing: Listing, cursor: ListCursor) {
  const { asked } = listing;
  let ranged = cursor.w === true;
  let fill = await walk(listing, ranged ? "" : asked.query, cursor.j);
  if (
    !ranged &&
    cursor.j === 0 &&
    fill.rows.length === 0 &&
    !listing.keywordUnavailable &&
    (asked.after || asked.before) &&
    asked.query
  ) {
    ranged = true;
    fill = await walk(listing, "", 0);
  }
  return { fill, ranged };
}

/** One source as the list view shows it: by title, date, app and author, with no excerpt. */
const listed = (
  source: Walked["rows"][number],
  names: ReadonlyMap<string, string>,
  linkTo: LinkTo,
) => ({
  id: source.id,
  title: source.title,
  app: source.app,
  ...connectionOf(source.connectionId, names),
  kind: source.kind,
  ...authorOf(source),
  ...datedAs("modifiedAt", source.sourceUpdatedAt, source.datePrecision),
  url: source.url,
  ...linkTo(source.id),
  ...instructionLikeField(source.instructionLike),
});

type Walk = {
  cursor: ListCursor;
  fill: Walked;
  ranged: boolean;
  names: ReadonlyMap<string, string>;
};

/**
 * What the list says of its query: that it is newest first; that nothing in the range matched, so the range is listed;
 * or, where the keyword index did not answer, that nothing was searched by the query's words, never that none matched.
 */
function saidOf(listing: Listing, ranged: boolean) {
  if (listing.asked.query && listing.keywordUnavailable)
    return {
      queryMatched: false,
      note: "Nothing was searched by the query's words: the keyword index could not be read, so this list is incomplete.",
    };
  if (ranged)
    return {
      queryMatched: false,
      note: "Nothing in this date range matched the query's words or meaning. These are every source in the range, newest first.",
    };
  return {
    queryMatched: true,
    ...(listing.asked.query
      ? {
          note: "Newest first, not by relevance: to find the answer to a question, search without `view`.",
        }
      : {}),
  };
}

function listPage(listing: Listing, { cursor, fill, ranged, names }: Walk) {
  const shown = hooksOf(listing.context).presentation;
  return {
    // A list is newest first, not ranked; the note says so where the agent reads it.
    order: "newest" as const,
    sources: fill.rows.map((source) => listed(source, names, shown.linkTo)),
    total: listing.total,
    totalIsLowerBound: listing.totalIsLowerBound,
    ...saidOf(listing, ranged),
    hasMore: fill.hasMore,
    ...(fill.hasMore
      ? {
          nextCursor: encodeCursor(
            {
              ...cursor,
              j: fill.next,
              ...(ranged ? { w: true as const } : {}),
            },
            shown.cursorKey(),
          ),
        }
      : {}),
    ...(listing.semanticUnavailable ? { semanticUnavailable: true } : {}),
  };
}
