import type { SourceSearch } from "@louvain/engine-core";
import { logOf, telemetryOf } from "../../host/given.js";
import { isUnreachable } from "../../observability/unreachable.js";
import { embedderOf } from "../../store/embedder.js";
import { bounded } from "../bounded.js";
import { narrow as narrowed, type ReadContext } from "../fence.js";
import { fenced } from "../fenced.js";
import { hooksOf } from "../hooks.js";
import { type Owner, type Scope, scope } from "./core.js";
import { emptySearch } from "./empty.js";
import { indexListing } from "./index-listing.js";
import type { SearchInput } from "./input.js";
import { keywordSources } from "./keyword.js";
import { REACH_DOCS, REACH_EVENTS } from "./limits.js";
import { sourceSort } from "./order.js";
import { timed } from "./timings.js";
import { sourceQueryVectorOf } from "./vector-space.js";

/** Search: the reader's reach, its stage timings, and the hybrid listing (meaning and words) over it. */
/**
 * The reader's whole reach, when it is small (`limits.ts`): the current documents of at most `REACH_EVENTS`
 * events of their containers, or null when the containers hold more events than that, or more than `REACH_DOCS`
 * documents. Read by the `(org_id, container)` index and, per event, the current-event index (`limit 1` in a lateral
 * keeps the planner from hashing the whole document table on its container estimate). Every id it returns is still
 * fenced by the statement that lists it.
 */
export async function reachOf(context: ReadContext, s: Scope): Promise<string[] | null> {
  return bounded(context, async (trx) => {
    // First how many events, by the index alone and stopping one past the bound: a dense reader pays only this.
    const [counted] = await trx<{ events: number }[]>`
      select count(*)::int as events from (
        select 1 from event_log
        where org_id = ${s.orgId} and ${fenced(trx, s, { column: trx`container`, shape: "any" })}
        limit ${REACH_EVENTS + 1}) t`;
    if (!counted || counted.events > REACH_EVENTS) return null;
    const [row] = await trx<{ ids: string[] }[]>`
      select coalesce(array_agg(distinct d.id) filter (where d.id is not null), '{}') as ids
      from event_log ev left join lateral (
        select d.id from source_document d where d.current_event_id = ev.id and d.org_id = ${s.orgId} limit 1
      ) d on true
      where ev.org_id = ${s.orgId} and ${fenced(trx, s, { column: trx`ev.container`, shape: "any" })}`;
    const ids = row?.ids ?? [];
    return ids.length > REACH_DOCS ? null : ids;
  });
}

/**
 * What a search walks: the reader's readable set, narrowed to the containers the input names, with their reach
 * (`reachOf`) and a narrowing's documents (`narrowedReach`, bound) where those are few; null when nothing is readable.
 * `searchSources` and any count of what a search would list read through this one preparation, so a count is of what
 * the search walks.
 */
export async function searchScope(
  context: ReadContext,
  owner: Owner,
  input: SearchInput,
): Promise<Scope | null> {
  const readable = await timed("scope", () => scope(context, owner));
  const scoped: Scope | null = input.containers ? narrowed(readable, input.containers) : readable;
  if (!scoped || scoped.containers.length === 0) return null;
  // A reader of little is listed from what they read (`reachOf`): the date walk would cross the tenant for it.
  const readerReach = await timed("reach", () => reachOf(context, scoped));
  // A narrowing is a narrow filter, and a newest-first walk with a narrow filter crosses the tenant to fill a page: so
  // its documents are read first when they are few (`narrowedReach`, bound after the fence).
  const narrow = input.narrow;
  const clientDocs = narrow
    ? await timed("client", () => hooksOf(context).filters.narrowedReach(scoped, narrow))
    : null;
  const reach =
    readerReach && clientDocs
      ? readerReach.filter((id) => clientDocs.includes(id))
      : (readerReach ?? clientDocs);
  return reach ? { ...scoped, reach } : scoped;
}

/**
 * The listing, with words or without. Words are the build's keyword index's where it holds documents
 * (`indexListingOrNone`, the open build's) and else a second matcher's (`ListingWords.listing`, words and meaning); a
 * build with neither has no listing with words, and says so. Without words, the date-ordered keyword page.
 */
export async function searchSources(
  context: ReadContext,
  {
    owner,
    input: given,
    embed = sourceQueryVectorOf(embedderOf(context)),
  }: { owner: Owner; input: SearchInput; embed?: (query: string) => Promise<number[] | null> },
): Promise<SourceSearch> {
  // A direction is judged for the owner, whoever asked (the route, an agent's tool): never a reader a request names.
  const input = given.direction ? { ...given, sentByReader: owner.principal } : given;
  const { keyword, filters } = hooksOf(context);
  if (input.q !== "" && !keyword.documents)
    return filters.words
      ? filters.words.listing(context, owner, input, embed)
      : { ...emptySearch(input, sourceSort(input)), keywordUnavailable: true };
  const s = await searchScope(context, owner, input);
  // Nothing readable is an empty page, not a walk of the whole tenant that finds nothing.
  if (!s) return emptySearch(input, sourceSort(input));
  if (input.q !== "") return timed("keyword", () => indexListingOrNone(context, s, input));
  return timed("keyword", () => keywordSources(context, s, input));
}

/**
 * The index's listing. A build whose listing reads its index REQUIRES it: where the index cannot answer (down, or older
 * than this engine), the listing is empty rather than a second matcher's, counted and said once with the fix.
 */
async function indexListingOrNone(
  context: ReadContext,
  s: Scope,
  input: SearchInput,
): Promise<SourceSearch> {
  try {
    return await indexListing(context, s, input);
  } catch (err) {
    telemetryOf(context).count("source_search_index_unavailable", 1, {});
    logOf(context).sayOnce(
      "the keyword index did not answer a listing; listings with words are empty until it does: ./engine logs bm25",
    );
    if (!isUnreachable(err)) telemetryOf(context).error("source_search.index_listing", err, {});
    return { ...emptySearch(input, sourceSort(input)), keywordUnavailable: true };
  }
}
