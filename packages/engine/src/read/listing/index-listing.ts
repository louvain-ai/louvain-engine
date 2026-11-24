import type { SourceSearch } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import { bounded } from "../bounded.js";
import { narrow, type ReadContext } from "../fence.js";
import { fenced } from "../fenced.js";
import { hooksOf } from "../hooks.js";
import { namedConnection } from "./apps.js";
import { boundedFacets } from "./bounds.js";
import { type Scope, type SourceRow, summary } from "./core.js";
import { type Listed, postList } from "./index-list.js";
import type { SearchInput } from "./input.js";
import { documentFence, sourceJoin, summaryColumns } from "./join.js";
import { documentEntryId, documentOfEntry } from "./keyword-documents.js";
import { sourceSort } from "./order.js";

/**
 * A listing with words, read from the keyword index, where the build's index holds document entries
 * (`keyword-documents.ts`): the one matcher decides which documents a listing holds, as it decides a search's.
 * The index pages, counts and facets the readable document entries that match (`services/keyword-index/bm25_listing.py` `listing`); each
 * page is read again here by document id under the same fence, in the index's order, so an entry the store no
 * longer holds is never shown. Facets come back by app and collection; a collection is named by the connection this
 * reader may name (`namedConnection`), so a reader of a child collection never learns its parent's.
 */
export async function indexListing(
  context: ReadContext,
  s: Scope,
  input: SearchInput,
): Promise<SourceSearch> {
  const unsupported = unsupportedIn(input);
  if (unsupported) throw new Error(`the keyword index's listing does not narrow by ${unsupported}`);
  const sort = sourceSort(input);
  const listed = await askList(context.sql, { s, input, sort });
  const rows = await documentsInOrder(context, s, listed.ids.map(documentOfEntry));
  const snippetOf = new Map(
    listed.ids.map((id, at) => [documentOfEntry(id), listed.snippets?.[at]]),
  );
  const added = hooksOf(context).filters;
  const [copies, occurrences] = await Promise.all([
    added.copiesOf(s, rows),
    added.occurrencesOf(s, rows),
  ]);
  const facets = input.facets === "skip" ? [] : await namedFacets(context.sql, s, listed.facets);
  return {
    sources: rows.map((r) => ({
      ...summary(r, hooksOf(context).detail.byline),
      excerpt: excerptOf(r, snippetOf.get(r.id)),
      ...copies(r),
      ...occurrences(r),
    })),
    total: listed.total,
    totalBounded: false,
    ...boundedFacets(facets),
    ...(listed.facetsBounded ? { facetsBounded: true } : {}),
    ...(input.facets === "skip" ? { facetsSkipped: true as const } : {}),
    offset: input.offset,
    hasMore: input.offset + listed.ids.length < listed.total,
    retrieval: "keyword",
    sort,
  };
}

/** The first narrowing the index's listing cannot carry, or null: the open tools send none of them. */
function unsupportedIn(input: SearchInput): string | null {
  const named = {
    connection: input.connection,
    kind: input.kind || input.kinds?.length,
    author: input.author || input.authors?.length,
    type: input.type || input.types?.length,
    direction: input.direction,
  };
  const set = Object.entries(named).find(([, value]) => value);
  if (set) return set[0];
  if (input.starredBy || input.news) return "a mark";
  return input.sort === "oldest" ? "oldest first" : null;
}

/** One `/list` call: the fence (the scope's collections, as of now), the words, the order, the page and the narrowings. */
async function askList(
  sql: Queryable,
  { s, input, sort }: { s: Scope; input: SearchInput; sort: string },
): Promise<Listed> {
  // A search quoted whole is a phrase (Elasticsearch's `match_phrase`), as a query string reads one.
  const phrase = /^"[^"]+"$/.test(input.q.trim());
  return postList({
    org: s.orgId,
    containers: s.containers,
    query: phrase ? input.q.trim().slice(1, -1) : input.q,
    ...(phrase ? { phrase: true } : {}),
    order: sort === "relevance" ? "relevance" : "newest",
    offset: input.offset,
    limit: 24,
    ...(input.app || input.apps?.length
      ? { apps: [...new Set([...(input.app ? [input.app] : []), ...(input.apps ?? [])])] }
      : {}),
    ...(await windowOf(sql, input)),
    ...(s.reach ? { ids: s.reach.map(documentEntryId) } : {}),
  });
}

/**
 * The date window as instants: an instant as written, a day as the whole day in the reader's time zone, resolved by
 * the database exactly as the Postgres listing's `dateWindow` resolves it.
 */
async function windowOf(
  sql: Queryable,
  input: SearchInput,
): Promise<{ from?: string; to?: string }> {
  const instant = (bound: string | undefined) => !!bound?.includes("T");
  const day = (bound: string | undefined) => (bound && !instant(bound) ? bound : null);
  const zone = input.timeZone ?? "UTC";
  const [w] =
    day(input.after) || day(input.before)
      ? await sql<{ from: Date | null; to: Date | null }[]>`select
          (${day(input.after)}::date::timestamp at time zone ${zone}) as from,
          ((${day(input.before)}::date + 1)::timestamp at time zone ${zone}) - interval '1 millisecond' as to`
      : [{ from: null, to: null }];
  const from = instant(input.after) ? input.after : w?.from?.toISOString();
  const to = instant(input.before) ? input.before : w?.to?.toISOString();
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** At or under this many characters a source is quoted whole: a fragment of it could start after its first word. */
const QUOTED_WHOLE = 400;
/** The opening a source is shown by where the index has no fragment for it. */
const OPENING = 600;

/**
 * A listed source's excerpt: the index's fragment where the search's words fell (`/list` `snippets`), or its opening
 * where it is short enough to quote whole or the index has no fragment (no word in its text: a match on its title).
 */
const excerptOf = (
  r: { opening: string; long: boolean },
  snippet: NonNullable<Listed["snippets"]>[number] | undefined,
): string => (r.long && snippet ? snippet.text : r.opening);

/** These documents' current revisions under the fence, in the order given; one the store no longer holds is left out. */
async function documentsInOrder(context: ReadContext, s: Scope, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await bounded(
    context,
    (trx) => trx<(SourceRow & { opening: string; long: boolean })[]>`
      select ${summaryColumns(trx, s, hooksOf(context).filters)},
        left(r.content, ${OPENING}) as opening, length(r.content) > ${QUOTED_WHOLE} as long ${sourceJoin(trx)}
      where ${documentFence(trx, s)} and r.event_id = d.current_event_id and d.id = any(${ids}::text[])`,
  );
  const at = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
}

/** The index's facets by app and collection, as facets by app and the connection this reader may name. */
async function namedFacets(sql: Queryable, s: Scope, facets: Listed["facets"]) {
  // The reader narrowed to the facets' containers: none of them readable is no facet, and no query.
  const faceted = narrow(s, [...new Set(facets.map((f) => f.container))]);
  const named = faceted
    ? await sql<{ container: string; connectionId: string | null }[]>`
    select distinct on (e.container) e.container, ${namedConnection(sql, s, "e")} as "connectionId"
    from event_log e where e.org_id = ${s.orgId} and ${fenced(sql, faceted, sql`e.container`)}
    order by e.container, e.id`
    : [];
  const connectionOf = new Map(named.map((n) => [n.container, n.connectionId]));
  const summed = new Map<string, { app: string; connectionId: string | null; count: number }>();
  for (const f of facets) {
    const connectionId = connectionOf.get(f.container) ?? null;
    const key = `${f.app}\u0000${connectionId ?? ""}`;
    const at = summed.get(key) ?? { app: f.app, connectionId, count: 0 };
    summed.set(key, { ...at, count: at.count + f.count });
  }
  return [...summed.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.app.localeCompare(b.app) ||
      (a.connectionId ?? "").localeCompare(b.connectionId ?? ""),
  );
}
