import type { SourceSearch } from "@louvain/engine-core";
import { bounded } from "../bounded.js";
import type { ReadContext } from "../fence.js";
import { hooksOf } from "../hooks.js";
import { filterApp, namedConnection } from "./apps.js";
import { boundedFacets, pageTotal, unlessSkipped } from "./bounds.js";
import { type Scope, type SourceRow, summary } from "./core.js";
import { andLeadsItsSeries, appFilter, listingFilter } from "./filter.js";
import type { AddedFilters } from "./filter-seam.js";
import type { Listing, SearchInput } from "./input.js";
import { listingJoin, summaryColumns } from "./join.js";
import { COUNT_LIMIT, WALK_LIMIT } from "./limits.js";
import { sourceSort, walkOrder } from "./order.js";
import type { ListingWords } from "./words-seam.js";

/** A listing whose filters carry a second matcher's words: only such a build ranks a listing by them. */
type Worded = Listing & { added: AddedFilters & { words: ListingWords } };
const worded = (l: Listing): l is Worded => l.added.words !== null;

/** A row's excerpt: a second matcher's for the words (`ListingWords.excerpt`), else the source's opening. */
const excerptColumn = ({ sql, added, input }: Listing) =>
  added.words ? added.words.excerpt(input.q) : sql`left(r.content, 600) as excerpt`;

/** The page in date order: the query a verification script explains, so what is verified is what is served. */
export function listingPage(listing: Listing, limit = 24) {
  const { sql, s, added, input } = listing;
  return sql`select ${summaryColumns(sql, s, added)}, ${excerptColumn(listing)}
    ${listingJoin(sql)} where ${listingFilter(listing)} and ${appFilter(listing)}
      ${andLeadsItsSeries(listing, true)}
    order by ${walkOrder(sql, sourceSort(input))} limit ${limit} offset ${input.offset}`;
}
/**
 * The page by relevance, ranked among the newest `WALK_LIMIT` matches: nothing indexes a rank, so ranking every match
 * of a common word reads each one. A rare word still starts from the words' index and ranks every match.
 */
function relevancePage(listing: Worded) {
  const { sql, s, added, input } = listing;
  const { words } = added;
  return sql`with candidates as (
      select d.id, d.current_event_id as event_id, d.current_modified_at as modified_at, ${words.column()} as search
      ${listingJoin(sql)} where ${listingFilter(listing)} and ${appFilter(listing)}
        ${andLeadsItsSeries(listing, true)}
      order by ${walkOrder(sql, "newest")} limit ${WALK_LIMIT}
    ), page as (
      select id, event_id,
        row_number() over (order by ${words.rank(input.q)} desc, modified_at desc, id asc) as rank
      from candidates order by rank limit 24 offset ${input.offset}
    )
    select ${summaryColumns(sql, s, added)}, ${excerptColumn(listing)}
    from page p join source_document d on d.id = p.id join source_revision r on r.event_id = p.event_id
    order by p.rank`;
}

/** The total, counted along the same walk and stopped one row past the cap (`bounds.ts`). */
export function listingCount(listing: Listing, limit = COUNT_LIMIT) {
  const { sql, input } = listing;
  // `limit`: the page's total stops past `SOURCE_COUNT_CAP`; a caller's typed chips may stop sooner.
  return sql`select count(*)::int as count from (
    select 1 ${listingJoin(sql)} where ${listingFilter(listing)} and ${appFilter(listing)}
      ${andLeadsItsSeries(listing, true)}
    order by ${walkOrder(sql, sourceSort(input))} limit ${limit}) t`;
}
/**
 * Sources by app AND connection among the newest `WALK_LIMIT` that match everything but the app filter: two
 * connections of one app (a person's own Drive, the workspace's) are two facets, told apart by the client.
 */
export function listingFacets(listing: Listing) {
  const { sql, s, added, input } = listing;
  return sql`select app, "connectionId", count(*)::int as count from (
    select ${filterApp(sql, added.app)} as app, ${namedConnection(sql, s, "ce")} as "connectionId"
    ${listingJoin(sql)} where ${listingFilter(listing)} ${andLeadsItsSeries(listing, false)}
    order by ${walkOrder(sql, sourceSort(input))} limit ${WALK_LIMIT}) t
    group by app, "connectionId" order by count(*) desc, app, "connectionId"`;
}
/**
 * The keyword page, its total and its facets, each a bounded read: its own transaction under the read timeout and the
 * plan-cache setting, so a read that cannot finish fails the request instead of holding a connection.
 */
export async function keywordSources(
  context: ReadContext,
  s: Scope,
  input: SearchInput,
): Promise<SourceSearch> {
  const sort = sourceSort(input);
  const skipFacets = input.facets === "skip";
  const [rows, counted, byApp] = await keywordReads(context, { s, input, skipFacets });
  const { total, totalBounded, hasMore } = pageTotal(input, counted, rows.length);
  const { facets, facetsBounded } = boundedFacets(byApp);
  const added = hooksOf(context).filters;
  const [copies, occurrences] = await Promise.all([
    added.copiesOf(s, rows),
    added.occurrencesOf(s, rows),
  ]);
  return {
    sources: rows.map((r) => ({
      ...summary(r, hooksOf(context).detail.byline),
      excerpt: r.excerpt,
      ...copies(r),
      ...occurrences(r),
    })),
    total,
    totalBounded,
    facets,
    facetsBounded,
    ...(skipFacets ? { facetsSkipped: true as const } : {}),
    offset: input.offset,
    hasMore,
    retrieval: input.q ? "keyword" : "recent",
    sort,
  };
}

/** The page, the count (unless skipped) and the facets, read side by side. */
function keywordReads(
  context: ReadContext,
  { s, input, skipFacets }: { s: Scope; input: SearchInput; skipFacets: boolean },
) {
  const sort = sourceSort(input);
  const added = hooksOf(context).filters;
  // Each read's listing is written with that read's own handle.
  const on = (sql: Listing["sql"]): Listing => ({ sql, s, added, input });
  const page = (l: Listing) =>
    sort === "relevance" && worded(l) ? relevancePage(l) : listingPage(l);
  return Promise.all([
    bounded(context, (q) => q<(SourceRow & { excerpt: string })[]>`${page(on(q))}`),
    unlessSkipped(input.count, () =>
      bounded(context, (q) => q<{ count: number }[]>`${listingCount(on(q))}`),
    ),
    // The facets count everything but the app filter: unchanged by a click on an app, a connection or a page.
    skipFacets
      ? Promise.resolve([])
      : bounded(
          context,
          (q) =>
            q<
              { app: string; connectionId: string | null; count: number }[]
            >`${listingFacets(on(q))}`,
        ),
  ]);
}
