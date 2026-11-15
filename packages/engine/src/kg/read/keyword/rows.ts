import { recordsInNarrowing } from "../bm25/records-in-narrowing.sql.js";
import { bm25Search } from "../bm25.js";
import { instantOf, queryTerms } from "../context.js";
import { firstChunkRows } from "../document-rows.js";
import { bounded, type ReadContext, type Reader } from "../fence.js";
import { hasRecordFilters, type RecordFilters } from "../filters.js";
import { hooksOf } from "../hooks.js";
import type { KeywordIndex } from "../keyword-index.js";
import { stillCurrent } from "../passages-filter.js";
import type { PassageFilters, Row } from "../passages-types.js";
import { passageTieOrder } from "../passages-vector.js";
import { bm25Tiers, type TierHit } from "./tiers.js";

/**
 * WHAT THE BM25 SIDECAR MAY NARROW BY, beside the fence it always applies (`apps/nlp/bm25.py`): nothing, as before,
 * or — under `LOUVAIN_BM25_FILTERED=on` (default OFF until a judged arm) — an app set (`apps`, its `app`
 * field) and a time range (`window`, or `since`/`until`). A filtered keyword search on a large workspace otherwise gets
 * only Postgres's narrow AND, and the OR pass that would tolerate a missing word is cut by its timeout.
 * Any other filter (a connector type, a sender, a genre, record ids, figures, knowledge time) keeps the Postgres
 * passes, which carry it in their predicate. `null` is "not the sidecar's".
 */
export type Bm25Narrowing = {
  apps?: string[];
  from?: string;
  to?: string;
  ids?: readonly string[];
  figures?: true;
};

const bm25FilteredOn = (): boolean =>
  (process.env.LOUVAIN_BM25_FILTERED ?? "").trim().toLowerCase() === "on";

/** What the build's keyword index (`index`) can narrow a read by itself, or null where the read goes to its passes. */
export function bm25Narrowing(index: KeywordIndex, f: PassageFilters): Bm25Narrowing | null {
  const { asOf, recordIds, since, until, digits, window, apps, containers: _c, ...rest } = f;
  // The sidecar has no knowledge time: a `knownAt` read takes the Postgres passes, which carry it.
  // A build that requires its index reads given records there too (Elasticsearch's `ids` query); one that keeps its
  // passes reads them in Postgres, as it always has.
  const inIndex = index.passes === null;
  if (
    ((recordIds !== undefined || digits === true) && !inIndex) ||
    instantOf(asOf, "passages.search").knownAt !== null
  )
    return null;
  if (hasRecordFilters(rest)) return null;
  const from = window?.from ?? since;
  const to = window?.to ?? until;
  // Given records and a figures read narrow in the index (`ids`, `figures`, each a must clause beside the fence).
  const ids = {
    ...(recordIds !== undefined ? { ids: [...recordIds] } : {}),
    ...(digits === true ? { figures: true as const } : {}),
  };
  const narrowed = (apps?.length ?? 0) > 0 || from !== undefined || to !== undefined;
  if (!narrowed) return ids;
  // A build that requires its index narrows in it; one that keeps its passes does so behind the switch.
  if (!bm25FilteredOn() && index.passes !== null) return null;
  return {
    ...ids,
    ...(apps && apps.length > 0 ? { apps } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/**
 * The BM25 sidecar's ranking, hydrated: its hits that are still their record's current version for this viewer
 * (`stillCurrent`, as every Postgres leg asks in `passageFilter`), each as its first passage under the fence. The
 * sidecar ranks every stored version, so it is asked for twice the page; when the versions this viewer has a newer
 * one of still leave the page short of what the sidecar had, the answer is `null` and the caller takes the Postgres
 * pass, which applies the rule before its limit, rather than a short page that looks complete. A NARROWED search's
 * hits are re-checked in SQL by the passage legs' own predicate (`recordPredicates`, `narrowedHere`), so an index
 * built before a record changed app, or one rounded to seconds, never widens a page; a hit dropped there is a short
 * page too.
 */
export async function bm25Rows(context: ReadContext, read: IndexRead): Promise<Row[] | null> {
  const hits = await indexHits(context, read);
  const kept = await stillReadable(context, read, hits);
  // A short page goes to the build's passes, which apply the rule before their limit; with none, it is the page.
  if (kept.length < Math.min(read.limit, hits.length) && hooksOf(context).keyword.passes !== null)
    return null;
  return passageRows(context, read, kept);
}

/** What a read of the keyword index asks: under this fence, for these words, this many, as of, narrowed. */
export type IndexRead = {
  fence: Reader;
  query: string;
  limit: number;
  asOf: PassageFilters["asOf"];
  narrowing?: Bm25Narrowing;
  /** A hit shown by its best-matching passage (`bestOf`), not its first. */
  best: boolean;
};

/** A hit of the index: its record, its score and the fragment where the search's words fell, if any. */
type Hit = { id: string; score: number; snippet?: { text: string } | null };

/** The index's hits, twice the page: a build whose index has tiers reads them, in their order (`keyword-index.ts`). */
async function indexHits(context: ReadContext, read: IndexRead): Promise<Hit[]> {
  const { fence, query, limit, asOf, narrowing = {} } = read;
  const at = instantOf(asOf, "passages.search").validAt;
  const ask = { orgId: fence.orgId, containers: fence.containers, query, limit: limit * 2 };
  return hooksOf(context).keyword.tiers
    ? (await bm25Tiers({ ...ask, asOf: at, narrow: narrowing })).hits.map(tierOrdered)
    : await bm25Search({ ...ask, asOf: at, ...narrowing });
}

/**
 * The hits this reader still reads, at most the page: the sidecar ranks every stored version, and only a record's
 * current one is a hit (`stillCurrent`); the given records and figures the index read only those of, and every other
 * narrowing is re-checked here by id (`narrowedHere`).
 */
async function stillReadable(context: ReadContext, read: IndexRead, hits: Hit[]): Promise<Hit[]> {
  const { fence, limit, asOf, narrowing = {} } = read;
  const ids = hits.map((h) => h.id);
  const current = await stillCurrent(context, fence, ids, asOf);
  const { ids: _given, figures: _stated, ...filters } = narrowing;
  const narrowed =
    Object.keys(filters).length > 0
      ? await narrowedHere(context, { fence, ids, n: filters })
      : null;
  return hits
    .filter((h) => current.has(h.id) && (narrowed === null || narrowed.has(h.id)))
    .slice(0, limit);
}

/** Each kept hit as its passage row under the fence, its best passage where the build has one, ties on stable keys. */
async function passageRows(context: ReadContext, read: IndexRead, kept: Hit[]): Promise<Row[]> {
  const { fence, query, asOf, narrowing = {} } = read;
  const best = read.best ? bestOf(context, query, kept) : null;
  const byEvent = await firstChunkRows(context.sql, hooksOf(context).reading, {
    orgId: fence.orgId,
    eventIds: kept.map((h) => h.id),
    containers: fence.containers,
    asOf: instantOf(asOf, "passages.search").validAt,
    ...(best ? { best } : {}),
    // A figures read shows the passage that states the figure, as the passage legs read it.
    ...(narrowing.figures ? { digits: true } : {}),
  });
  const rows = kept.flatMap((h) => {
    const r = byEvent.get(h.id);
    return r ? [rowOf(h, r)] : [];
  });
  // An exact tie in the index's score breaks on stable keys, as every leg's does (`passageTieOrder`).
  return rows.sort((a, b) => b.score - a.score || passageTieOrder(a, b));
}

/** A hit and its passage as one row of the leg. */
const rowOf = (
  h: Hit,
  r: {
    id: string;
    seq?: number;
    text: string;
    container: string;
    author: string | null;
    occurredAt: string;
  },
): Row & { score: number } => ({
  id: r.id,
  event_id: h.id,
  seq: r.seq ?? 0,
  text: r.text,
  container: r.container,
  author: r.author,
  occurred_at: new Date(r.occurredAt),
  score: h.score,
});

/**
 * A tier's hit as one score that keeps the tiers' order: its words, plus its BM25 squashed into [0, 1). Each tier is
 * ranked by its own BM25, so raw scores do not compare across tiers; a reader of scores (a decaying read, a convex
 * fusion) then still ranks a hit holding more words first, as Meilisearch's words rule does.
 */
const tierOrdered = (h: TierHit) => ({
  id: h.id,
  score: h.words + h.score / (1 + h.score),
  snippet: h.snippet ?? null,
});

/** Of the sidecar's hits, those the passage legs' own filter keeps: by id, so bounded by the page. */
async function narrowedHere(
  context: ReadContext,
  { fence, ids, n }: { fence: Reader; ids: readonly string[]; n: Bm25Narrowing },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const filters: RecordFilters = {
    ...(n.apps ? { apps: n.apps } : {}),
    ...(n.from !== undefined || n.to !== undefined
      ? { window: { ...(n.from ? { from: n.from } : {}), ...(n.to ? { to: n.to } : {}) } }
      : {}),
  };
  const added = hooksOf(context).filters;
  const rows = await bounded(context, (q) =>
    recordsInNarrowing(q, fence.orgId, { ids, filters, added }),
  );
  return new Set(rows.map((r) => r.id));
}

/** The order that shows each kept document by its best passage (`keyword-index.ts` `best`). */
function bestOf(
  context: ReadContext,
  query: string,
  kept: { id: string; snippet?: { text: string } | null }[],
) {
  const snippets = new Map(
    kept.flatMap((h) => (h.snippet?.text ? [[h.id, h.snippet.text] as const] : [])),
  );
  return hooksOf(context).keyword.best(context.sql, { terms: queryTerms(query), snippets });
}
