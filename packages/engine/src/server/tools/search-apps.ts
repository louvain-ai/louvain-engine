import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import { knownAtScope } from "../../read/instant.js";
import { searchHeadDepth } from "../../search/depth.js";
import type { SearchWith } from "../../search/pool-types.js";
import { asOf, type ClientNarrow, clamp, str, ToolInputError } from "./arguments.js";
import { withContainers } from "./collections.js";
import { listSources, searchAsAnswers } from "./search.js";
import { directionOf, strs } from "./search-asked.js";
import { excludedOf } from "./search-exclude.js";
import { FULL_HITS } from "./search-hits.js";
import { holdersPage } from "./search-holders.js";
import { CursorRefused, decodeCursor, type SearchCursor, searchKey } from "./search-paging.js";
import { unranked } from "./search-ranking.js";
import { namesOnlySearch, searchable } from "./search-relevance.js";
import { unheldWords } from "./search-unheld.js";

/** The most rows a page returns in full when a `limit` is asked for: the 24-row head, whatever the head's depth. */
const FULL_ASKED_MAX = 24;

/**
 * One container, as a scope (`container`): the caller's scope (whatever the build scopes by, none in the open build)
 * narrowed to that one id. `searchSources` intersects it with the reader's readable set, so a container they cannot
 * read is an empty page, never an error and never a second definition of the fence.
 */
function scopedTo(containers: string[] | undefined, container: string): string[] | undefined {
  if (!container) return containers;
  return containers ? containers.filter((c) => c === container) : [container];
}

/**
 * A list ends by saying so: on its last page "that is all N"; "at least N" whenever the listing's count is a floor (past
 * `SOURCE_COUNT_CAP`, or a meaning search's bounded candidates); before the last page, how many there are in all.
 */
export function endOf(page: {
  total: number;
  totalIsLowerBound: boolean;
  hasMore: boolean;
}): string {
  if (page.totalIsLowerBound)
    return `At least ${page.total} sources: the count stopped before it reached them all.${page.hasMore ? " Pass nextCursor as cursor for the next page." : ""}`;
  if (!page.hasMore) return `That is all ${page.total}.`;
  return `${page.total} in all; pass nextCursor as cursor for the next page.`;
}

/**
 * What a build scopes one search to: the containers it searches within (none in the open build), and a narrowing of its
 * own (a place the build knows, opaque here) that stands where a `client` argument's would: the listing's narrowing for
 * the list view, its records for the ranked head. Both only narrow, after the fence.
 */
type BuildScope = { containers?: string[] | undefined; narrowing?: ClientNarrow | undefined };

/**
 * One search as asked: the ranked page or the list view, by its cursor (a build's app hint may call it twice). The
 * ranked page reads `pool`, the build's: the open build's retrievers, or another build's own candidates.
 */
export async function searchOrList(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  scope: BuildScope | undefined,
  pool: SearchWith,
) {
  const container = str(args.container);
  const containers = scopedTo(scope?.containers, container);
  const within = { containers, narrowing: scope?.narrowing };
  const page = await pageOf(context, args, ctx, within, container, pool);
  const placed = await withContainers(context, ctx, page);
  return "total" in placed ? { ...placed, end: endOf(placed) } : placed;
}

async function pageOf(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  within: BuildScope,
  container: string,
  pool: SearchWith,
) {
  const { containers } = within;
  // No `limit`: the whole ranked head, its tail compact (`searchHeadDepth`); one asked for is full.
  // A model sends `null` or "" for an optional number it does not want: that is no limit, not a limit of one.
  const given =
    args.limit === null || args.limit === "" || !Number.isFinite(Number(args.limit))
      ? undefined
      : args.limit;
  // The head's depth: 24, or 100 under `LOUVAIN_SEARCH_WIDE=on` (`searchHeadDepth`); the default page is all of it.
  const depth = searchHeadDepth();
  const limit = clamp(given, depth, depth);
  // A limit asked for is returned in full up to 24 rows (about 25k characters), the rest compact: a wide page of 100
  // in full was about 105k characters a call.
  const fullHits = given === undefined ? FULL_HITS : Math.min(limit, FULL_ASKED_MAX);
  // A container with no query is "everything in it": the list view. So is a direction: who sent a message is told by
  // the listing alone (`SearchInput.direction`), and a ranked hit it could not tell would slip past the filter.
  const direction = directionOf(args.direction);
  const view =
    args.view === "list" || (container && !str(args.query)) || direction ? "list" : "ranked";
  const key = keyOf(args, { container, view, scope: within.narrowing?.key });
  let cursor: SearchCursor;
  try {
    cursor = str(args.cursor)
      ? decodeCursor(str(args.cursor), key, hooksOf(context).presentation.cursorKey())
      : view === "list"
        ? { v: 1, k: key, p: "list", j: 0 }
        : { v: 1, k: key, p: "ranked", o: 0 };
  } catch (err) {
    if (err instanceof CursorRefused) throw new ToolInputError(err.message);
    throw err;
  }
  if (view === "list") {
    // The list view reads the listing, which has no knowledge time: refused rather than unbounded.
    if (knownAtScope() !== undefined)
      throw new ToolInputError(
        'knownAt applies to the ranked search only: omit view: "list", or omit knownAt.',
      );
    const client = await clientOf({ context, args, ctx }, within.narrowing, false);
    return listSources(context, args, ctx, {
      ...{ limit: clamp(given, 50, 100), containers },
      ...{ cursor, client },
    });
  }
  const client = await clientOf({ context, args, ctx }, within.narrowing, true);
  // A search with nothing to look for ("?!") is refused, never answered by meaning alone.
  if (str(args.query) && !searchable(str(args.query)))
    throw new ToolInputError(
      "A search needs a word or a figure to look for, and this one has neither.",
    );
  const said = await unheldWords(context, ctx, str(args.query), containers);
  const asked = args;
  const page = { limit, containers, cursor, pool, client, fullHits };
  // A search that only names things is answered by the documents holding it (rule 6, `search-holders.ts`), and never
  // reranked: nothing in it is measured by meaning, so a reranker could neither reorder nor add to it.
  if (namesOnlySearch(context, str(asked.query), args.mode === "keyword" ? "keyword" : "hybrid"))
    return said(await holdersPage(context, asked, ctx, { ...page, pool: unranked(pool) }));
  return said(await searchAsAnswers(context, asked, ctx, page));
}

/**
 * The narrowing a search reads: its `client` argument's, as the bound presentation resolves it, or the build's own; one
 * at a time, since a listing holds one narrowing.
 */
async function clientOf(
  asked: { context: ReadContext; args: Record<string, unknown>; ctx: Viewer },
  narrowing: ClientNarrow | undefined,
  ranked: boolean,
): Promise<ClientNarrow | undefined> {
  const client = str(asked.args.client);
  if (client && narrowing)
    throw new ToolInputError("Pass a client or a place to search within, not both.");
  if (!client) return narrowing;
  return hooksOf(asked.context).presentation.clientNarrow(asked.ctx, client, ranked);
}

/**
 * The search a cursor belongs to: the query, every filter, the build's scope (its narrowing's own `key`) and the view.
 * A cursor from another is refused.
 */
function keyOf(
  args: Record<string, unknown>,
  {
    container,
    view,
    scope,
  }: { container: string; view: "list" | "ranked"; scope?: string | undefined },
) {
  return searchKey({
    query: str(args.query),
    mode: args.mode === "keyword" ? "keyword" : "hybrid",
    // Several apps are one filter, in any order; one app keys as it always did, so older cursors keep their key.
    app: strs(args.app).sort().join(","),
    ...(directionOf(args.direction) ? { direction: directionOf(args.direction) as string } : {}),
    after: str(args.after),
    before: str(args.before),
    // One space keys as it always did; several, in any order, are one filter.
    space: strs(args.space).sort().join(","),
    // Another container is another search; only when given, so every older cursor keeps its key.
    ...(container ? { container } : {}),
    ...(str(args.client) ? { client: str(args.client) } : {}),
    // Another place the build scoped the search to is another search; only when given, so older cursors keep their key.
    ...(scope ? { scope } : {}),
    // The person's question ranks the head when the deployment searches it: another question is another search.
    // Only when given, so every cursor issued before `question` existed keeps its key.
    ...(str(args.question) ? { question: str(args.question) } : {}),
    // Another set of sources already shown is another search; only when given, so older cursors keep their key.
    ...(excludedOf(args).size > 0 ? { exclude: JSON.stringify([...excludedOf(args)].sort()) } : {}),
    // A wide head is another search: its cursors are not a 24-deep one's. Only when on, so older cursors keep their key.
    ...(searchHeadDepth() > FULL_ASKED_MAX ? { wide: "on" } : {}),
    asOf: asOf(args.asOf),
    // A page as known on one day is not a page of the search as known now: they never share a cursor.
    // Only when given, so every cursor issued before knownAt existed keeps its key.
    ...(asOf(args.knownAt) ? { knownAt: asOf(args.knownAt) } : {}),
    view,
  });
}
