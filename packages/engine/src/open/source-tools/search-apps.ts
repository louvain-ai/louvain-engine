import type { Viewer } from "@louvain/engine-core";
import { searchHeadDepth } from "../../ask/search-wide.js";
import { knownAtScope } from "../../kg/read/context.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import type { SearchWith } from "../../search/document.js";
import { withContainers } from "./containers.js";
import { excludedOf } from "./search-exclude.js";
import { FULL_HITS } from "./search-hits.js";
import { holdersPage } from "./search-holders.js";
import { CursorRefused, decodeCursor, type SearchCursor, searchKey } from "./search-paging.js";
import { unranked } from "./search-ranking.js";
import { listSources, searchAsAnswers } from "./search-read.js";
import { namesOnlySearch, searchable } from "./search-relevance.js";
import { unheldWords } from "./search-unheld.js";
import { asOf, clamp, str, ToolInputError } from "./tool-helpers.js";

/** The most rows a page returns in full when a `limit` is asked for: the 24-row head, whatever the head's depth. */
const FULL_ASKED_MAX = 24;

/**
 * ONE CONTAINER, AS A SCOPE (`container`): the caller's scope (a space's closure in the product, none in the open build)
 * narrowed to that one id. `searchSources` intersects it with the reader's readable set, so a container they cannot
 * read is an empty page, never an error and never a second definition of the fence.
 */
function scopedTo(containers: string[] | undefined, container: string): string[] | undefined {
  if (!container) return containers;
  return containers ? containers.filter((c) => c === container) : [container];
}

/**
 * A LIST ENDS BY SAYING SO: on its last page "that is all N"; "at least N" whenever the listing's count is a floor (past
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
 * One search as asked: the ranked page or the list view, by its cursor (the product's app hint may call it twice). The
 * ranked page reads `pool`, the build's: the open build's retrievers, the product's own `candidates()`.
 */
export async function searchOrList(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  scopeContainers: string[] | undefined,
  pool: SearchWith,
) {
  const container = str(args.container);
  const containers = scopedTo(scopeContainers, container);
  const page = await pageOf(context, args, ctx, containers, container, pool);
  const placed = await withContainers(context, ctx, page);
  return "total" in placed ? { ...placed, end: endOf(placed) } : placed;
}

async function pageOf(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  containers: string[] | undefined,
  container: string,
  pool: SearchWith,
) {
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
  const spaceId = str(args.space);
  // A container with no query is "everything in it": the list view.
  const view = args.view === "list" || (container && !str(args.query)) ? "list" : "ranked";
  // The search a cursor belongs to: the query, every filter and the view. A cursor from another is refused.
  const key = searchKey({
    query: str(args.query),
    mode: args.mode === "keyword" ? "keyword" : "hybrid",
    app: str(args.app),
    after: str(args.after),
    before: str(args.before),
    space: spaceId,
    // Another container is another search; only when given, so every older cursor keeps its key.
    ...(container ? { container } : {}),
    ...(str(args.client) ? { client: str(args.client) } : {}),
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
    const client = str(args.client)
      ? await hooksOf(context).presentation.clientNarrow(ctx, str(args.client), false)
      : undefined;
    return listSources(context, args, ctx, {
      ...{ limit: clamp(given, 50, 100), containers },
      ...{ cursor, client },
    });
  }
  const client = str(args.client)
    ? await hooksOf(context).presentation.clientNarrow(ctx, str(args.client), true)
    : undefined;
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
