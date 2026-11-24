import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import type { SearchWith } from "../../search/pool-types.js";
import { search } from "../../search/search.js";
import { asOf, type ClientNarrow, str } from "./arguments.js";
import {
  fromListing,
  headOptions,
  listingCursor,
  listingPage,
  narrowOf,
  type Shown,
} from "./search.js";
import { searchAskedOf, strs } from "./search-asked.js";
import type { Narrowing } from "./search-exact.js";
import { excludedOf, headOf } from "./search-exclude.js";
import { encodeCursor, fillFromListing, idPrefix, type SearchCursor } from "./search-paging.js";
import {
  asWritten,
  type HeadSplit,
  holdersAmong,
  rankedHits,
  splitHead,
} from "./search-relevance.js";

/** The holders' page asked: how many, in full how many, inside which containers, from which cursor, over which pool. */
type HoldersAsked = {
  limit: number;
  containers: string[] | undefined;
  cursor: SearchCursor;
  client: ClientNarrow | undefined;
  fullHits: number;
  pool: SearchWith;
};

/**
 * The pages of a search that only names things (rule 6, `namesOnlySearch`): every document holding what it names, and
 * nothing else, in the order a person can account for: the documents it names (the exact tier, then the documents
 * citing that key), then the keyword listing's order. Meaning takes no part, in the order or in what is shown, so a
 * look-alike never takes a place. The listing is walked past the first page, holders only, so walking to the end
 * returns each holder once; where the listing's own count is a floor, the last page says "at least".
 */
export async function holdersPage(
  context: ReadContext,
  args: Record<string, unknown>,
  ctx: Viewer,
  page: HoldersAsked,
) {
  const { limit, containers, cursor, client, fullHits, pool } = page;
  const owner = { orgId: ctx.orgId, principal: ctx.principal };
  const query = str(args.query);
  const excluded = excludedOf(args);
  const narrowing: Narrowing = {
    apps: strs(args.app),
    after: str(args.after) || undefined,
    before: str(args.before) || undefined,
    containers,
    client,
    excluded,
    asOf: asOf(args.asOf),
  };
  // The keyword legs' own ranking, never the meaning leg's: the text index and the keyword sidecar each find spellings
  // the listing's query cannot (a figure written inside a key, "PO-4471", is held as "-4471" by the text index).
  const narrow = narrowOf(narrowing);
  const legs = await search(
    {
      context,
      reader: owner,
      query,
      options: headOptions(searchAskedOf(args), "keyword", narrow),
    },
    pool,
  );
  const ranked = headOf(
    await asWritten(context, owner, legs.documents),
    narrowing.apps,
    client,
    excluded,
  );
  const named = await splitHead(context, owner, query, ranked, "hybrid", narrowing);
  const head = named.ordered as Shown[];
  const headIds = head.map((d) => idPrefix(d.summary.id));
  const at = cursor.p === "ranked" ? cursor.o : head.length;
  let shown = head.slice(at, at + limit);
  let next: SearchCursor | null = null;
  let floor = false;
  if (cursor.p === "ranked" && at + limit < head.length)
    next = { v: 1, k: cursor.k, p: "ranked", o: at + limit };
  else {
    const fill = await holdersPast(context, owner, args, cursor, limit - shown.length, headIds, {
      containers,
      client,
    });
    shown = [...shown, ...fill.rows];
    floor = fill.floor;
    next = fill.hasMore
      ? listingCursor(cursor.k, {
          j: fill.next,
          headIds: head.map((d) => d.summary.id),
          matched: true,
        })
      : null;
  }
  const names = await hooksOf(context).presentation.connectionNames(
    ctx.orgId,
    ctx.principal,
    shown.flatMap((d) => (d.summary.connectionId ? [d.summary.connectionId] : [])),
  );
  const split: HeadSplit<Shown> = {
    ordered: [],
    matches: named.matches,
    matched: named.matched === true || cursor.p === "listing" || shown.length > 0,
    meaning: null,
  };
  return {
    ...(await rankedHits(context, owner, query, shown, names, fullHits, "hybrid", split)),
    hasMore: next !== null,
    ...(next ? { nextCursor: encodeCursor(next, hooksOf(context).presentation.cursorKey()) } : {}),
    ...(floor && next === null ? { note: AT_LEAST } : {}),
    ...(legs.degraded.length > 0 ? { degraded: legs.degraded } : {}),
  };
}

const AT_LEAST =
  "These are the documents the listing counted as holding what this search names; more may hold it past that count.";

/**
 * The keyword listing past the documents already shown, holders only: a row that does not hold what the search names
 * is passed over like one already shown, so each page is full and `hasMore` means another holder follows.
 */
async function holdersPast(
  context: ReadContext,
  owner: Viewer,
  args: Record<string, unknown>,
  cursor: SearchCursor,
  want: number,
  headIds: string[],
  within: { containers: string[] | undefined; client: ClientNarrow | undefined },
) {
  const skip = new Set([
    ...headIds,
    ...(cursor.p === "listing" ? cursor.r : []),
    ...[...excludedOf(args)].map(idPrefix),
  ]);
  let floor = false;
  // The listing reads through the analyzer: a key or figure is found however written.
  const asked = searchAskedOf(args);
  const fill = await fillFromListing(
    async (offset) => {
      const got = await listingPage(context, owner, asked, { mode: "keyword", offset, ...within });
      floor ||= got.totalBounded === true;
      const rows = got.sources.map(fromListing);
      const held = await holdersAmong(context, owner, str(args.query), rows);
      for (const row of rows) if (!held.has(row.recordId)) skip.add(idPrefix(row.summary.id));
      return {
        rows: rows.map((d) => ({ ...d, id: idPrefix(d.summary.id) })),
        hasMore: got.hasMore,
      };
    },
    { from: cursor.p === "listing" ? cursor.j : 0, want, skip, pageSize: 24 },
  );
  return { ...fill, floor };
}
