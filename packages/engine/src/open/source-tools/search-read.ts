import type { Viewer } from "@louvain/engine-core";
import { searchHeadDepth } from "../../ask/search-wide.js";
import { knownAtScope } from "../../kg/read/context.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import type { SearchWith } from "../../search/document.js";
import { search } from "../../search/search.js";
import { type SearchAsked, searchAskedOf } from "./search-asked.js";
import { headOf, listingPast } from "./search-exclude.js";
import { fromListing, type Listed, listingCursor, listingPage, type Shown } from "./search-fill.js";
import {
  OUTSIDE_WINDOW_READ,
  outsideWindowField,
  outsideWindowOf,
  type ShownHit,
} from "./search-hits.js";
import { encodeCursor, fillFromListing, type SearchCursor } from "./search-paging.js";
import { rankingOf, readAs } from "./search-ranking.js";
import {
  asWritten,
  type HeadSplit,
  type Matched,
  rankedHits,
  splitHead,
  unmeasured,
} from "./search-relevance.js";
import { type ClientNarrow, ToolInputError } from "./tool-helpers.js";

export { fromListing, listingCursor, listingPage, type Shown } from "./search-fill.js";
export { listSources } from "./search-list.js";

/**
 * `louvain_search_sources` OVER THE SEARCH COMPOSER (`search/search.ts`), reading the caller's pool: what an agent is
 * shown is what an answer would read. The ranked head comes first, at its full depth on every page; the source listing
 * (`searchSources`, the same fence) then fills what passages cannot find, such as a file read for its metadata only,
 * after the head and never repeating it: a second source can only add a document, never hide one. An app, dates and a
 * space each narrow the fence, never widen it.
 */
export async function searchAsAnswers(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  page: AnswersAsked,
) {
  const asked = searchAskedOf(args);
  const owner = { orgId: ctx.orgId, principal: ctx.principal };
  const { cursor, pool } = page;
  const { mode, meaning, ranking } = await rankingOf(context, owner, args, { cursor, pool });
  const listing = (offset: number) =>
    listingPage(context, owner, asked, {
      ...{ mode, offset },
      ...{ containers: page.containers, client: page.client },
    });
  const run: Run = { context, asked, owner, page, mode, meaning, ranking, listing };
  let placed: Placed;
  if (cursor.p === "ranked") placed = await rankedPage(run, cursor);
  else if (cursor.p === "listing") placed = await pastHead(run, cursor);
  else throw new ToolInputError('That cursor belongs to the list view: pass view: "list".');
  return answered(run, placed);
}

/** The ranked view's page: how many, in full how many, inside which containers, from which cursor, over which pool. */
type AnswersAsked = {
  limit: number;
  containers: string[] | undefined;
  cursor: SearchCursor;
  pool: SearchWith;
  client?: ClientNarrow | undefined;
  fullHits?: number;
};

/** What the head and the listing narrow by: an app, a date window, a space's containers (each only narrows the fence). */
export function narrowOf(within: {
  app: string | undefined;
  after: string | undefined;
  before: string | undefined;
  containers: string[] | undefined;
}) {
  const { app, after, before, containers } = within;
  return {
    // The app each record shows as (or its connector's type): the value the head and the listing compare too.
    ...(app ? { apps: [app] } : {}),
    ...(after || before
      ? {
          window: {
            ...(after ? { from: after } : {}),
            ...(before ? { to: `${before}T23:59:59.999Z` } : {}),
          },
        }
      : {}),
    ...(containers ? { containers } : {}),
  };
}

/** The ranked head's options: the answer path's full depth, the person's question when the agent sent it. */
export function headOptions(
  asked: SearchAsked,
  mode: "hybrid" | "keyword",
  narrow: ReturnType<typeof narrowOf>,
) {
  return {
    limit: searchHeadDepth(),
    mode,
    ...(asked.excluded.size > 0 ? { exclude: asked.excluded } : {}),
    ...(asked.question ? { question: asked.question } : {}),
    ...(asked.at ? { asOf: asked.at } : {}),
    ...(Object.keys(narrow).length > 0 ? { narrow } : {}),
    ...readAs(),
  };
}

/** One ranked search as it runs: what it reads on, what was asked, by whom, ranked how, and its listing. */
type Run = {
  context: ReadContext;
  asked: SearchAsked;
  owner: Viewer;
  page: AnswersAsked;
  mode: "hybrid" | "keyword";
  meaning: Awaited<ReturnType<typeof rankingOf>>["meaning"];
  ranking: SearchWith;
  listing: (offset: number) => Promise<Listed>;
};

/** What one page shows, the cursor past it, and what it says about how it was read. */
type Placed = {
  shown: Shown[];
  split: HeadSplit<Shown> | null;
  next: SearchCursor | null;
  degraded: string[];
  outside: ShownHit[];
  semanticUnavailable: boolean;
};

type RankedCursor = Extract<SearchCursor, { p: "ranked" }>;

/**
 * The head at its full depth, on every page: a ranked order cannot be resumed from a key, so it is made the same order
 * each call, the answer path's top `searchHeadDepth()`, then the listing. The matches lead (`splitHead`).
 */
async function rankedPage(run: Run, cursor: RankedCursor): Promise<Placed> {
  const { found, first, wider, degraded } = await headRead(run, cursor);
  const { asked, page } = run;
  const split = await splitOf(run, found);
  const headIds = split.ordered.map((d) => d.summary.id);
  const known = new Set([...headIds, ...asked.excluded]); // shown, or already shown: never "outside the range"
  const outside = outsideWindowOf(wider?.documents ?? [], known, asked.app, page.client?.records);
  const shown = split.ordered.slice(cursor.o, cursor.o + page.limit);
  const filled = await pageOfHead(run, { cursor, split, shown, headIds, first });
  return {
    ...filled,
    split,
    degraded,
    outside,
    semanticUnavailable: first.semanticUnavailable ?? false,
  };
}

/** The head, the listing's first page beside it, and on a dated first page the same search without its dates. */
async function headRead(run: Run, cursor: RankedCursor) {
  const { asked, owner, page } = run;
  const narrow = narrowOf({ ...asked, containers: page.containers });
  const degraded: string[] = [];
  const [found, first, wider] = await Promise.all([
    search(
      {
        context: run.context,
        reader: owner,
        query: asked.query,
        options: headOptions(asked, run.mode, narrow),
      },
      run.ranking,
    ),
    run.listing(0),
    (asked.after || asked.before) && cursor.o === 0 ? withoutWindow(run, narrow, degraded) : null,
  ]);
  return { found, first, wider, degraded: [...degraded, ...found.degraded] };
}

/** A date window says what it left out (`outsideWindowOf`): the same ranked search without the window. */
function withoutWindow(
  run: Run,
  narrow: ReturnType<typeof narrowOf> & { window?: unknown },
  degraded: string[],
) {
  const { asked } = run;
  const { window: _window, ...unwindowed } = narrow;
  const options = {
    limit: OUTSIDE_WINDOW_READ,
    mode: run.mode,
    ...(asked.question ? { question: asked.question } : {}),
    ...(asked.at ? { asOf: asked.at } : {}),
    ...(Object.keys(unwindowed).length > 0 ? { narrow: unwindowed } : {}),
    ...readAs(),
  };
  return search(
    { context: run.context, reader: run.owner, query: asked.query, options },
    run.ranking,
  ).catch(() => {
    // swallowed: the window's own results stand; what it left out is a hint, named as unavailable.
    degraded.push("window:outside_unavailable");
    return null;
  });
}

/** The head as shown, split into the documents that match and the rest; a client narrows it after retrieval. */
async function splitOf(run: Run, found: Awaited<ReturnType<typeof search>>) {
  const { asked, owner, page } = run;
  const { app, after, before, at, excluded } = asked;
  const { containers, client } = page;
  const split: HeadSplit<Shown> = await splitHead(
    run.context,
    owner,
    asked.query,
    headOf(await asWritten(run.context, owner, found.documents), app, client, excluded),
    run.mode,
    {
      ...{ app, after, before, containers, client, asOf: at },
      excluded,
      reranked: found.reranked,
      ...(run.meaning !== undefined ? { meaning: run.meaning } : {}),
    },
  );
  return split;
}

type HeadAt = {
  cursor: RankedCursor;
  split: HeadSplit<Shown>;
  shown: Shown[];
  headIds: string[];
  first: Listed;
};

/** The page within the head, or past its end the listing's fill, unless the search reads as of a day or unmeasured. */
async function pageOfHead(run: Run, at: HeadAt): Promise<Pick<Placed, "shown" | "next">> {
  const { cursor, split, shown } = at;
  const { limit } = run.page;
  if (cursor.o + limit < split.ordered.length)
    return { shown, next: { v: 1, k: cursor.k, p: "ranked", o: cursor.o + limit } };
  // The listing has no knowledge time, so a search as known on a day does not fill: a later document must not return.
  if (knownAtScope() !== undefined || unmeasured(split)) return { shown, next: null };
  return fillPastHead(run, at);
}

/** The listing fills what passages cannot find, after the head and never repeating it. */
async function fillPastHead(run: Run, at: HeadAt): Promise<Pick<Placed, "shown" | "next">> {
  const { cursor, split, shown, headIds, first } = at;
  const skip = new Set([...headIds, ...run.asked.excluded]);
  const fill = await fillFromListing(
    async (offset) => {
      const got = offset === 0 ? first : await run.listing(offset);
      return {
        rows: got.sources.map(fromListing).map((d) => ({ ...d, id: d.summary.id })),
        hasMore: got.hasMore,
      };
    },
    { from: 0, want: run.page.limit - shown.length, skip, pageSize: 24 },
  );
  return {
    shown: [...shown, ...fill.rows],
    next: fill.hasMore
      ? listingCursor(cursor.k, { j: fill.next, headIds, matched: split.matched === true })
      : null,
  };
}

/** A page past the head: the listing alone, from the cursor's place, skipping what the head showed. */
async function pastHead(
  run: Run,
  cursor: Extract<SearchCursor, { p: "listing" }>,
): Promise<Placed> {
  let semanticUnavailable = false;
  const fill = await listingPast(cursor, run.page.limit, run.asked.excluded, async (offset) => {
    const got = await run.listing(offset);
    semanticUnavailable ||= got.semanticUnavailable ?? false;
    return { rows: got.sources.map(fromListing), hasMore: got.hasMore };
  });
  return {
    shown: fill.rows,
    // Whether the search matched: the head's, carried past it in the listing cursor.
    split: cursor.m ? MATCHED_PAST : null,
    next: fill.hasMore ? { ...cursor, j: fill.next } : null,
    ...{ degraded: [], outside: [], semanticUnavailable },
  };
}

/** The page as the agent reads it: each document placed and matched, the cursor, and how it was read. */
async function answered(run: Run, placed: Placed) {
  const { shown, split, next, degraded, outside, semanticUnavailable } = placed;
  const { owner, page } = run;
  const { presentation } = hooksOf(run.context);
  const names = await presentation.connectionNames(
    owner.orgId,
    owner.principal,
    shown.flatMap((d) => (d.summary.connectionId ? [d.summary.connectionId] : [])),
  );
  const fullHits = page.fullHits ?? page.limit;
  return {
    ...(await rankedHits(
      run.context,
      owner,
      run.asked.query,
      shown,
      names,
      fullHits,
      run.mode,
      split,
    )),
    hasMore: next !== null,
    ...(next ? { nextCursor: encodeCursor(next, presentation.cursorKey()) } : {}),
    ...outsideWindowField(outside, presentation.linkTo),
    ...(degraded.length > 0 ? { degraded } : {}),
    ...(semanticUnavailable ? { semanticUnavailable: true } : {}),
  };
}

/** A page past the head of a search whose head matched: it says so too. */
const MATCHED_PAST = { ordered: [], matches: new Map<string, Matched>(), matched: true };
