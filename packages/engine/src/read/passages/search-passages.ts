import { decayed, fuse, type Viewer } from "@louvain/engine-core";
import { passageContextMode, readsPassageContext } from "../../store/context-mode.js";
import { locateQuote } from "../../text/words.js";
import { fence, type ReadContext } from "../fence.js";
import { agentWritten, instructionLikeRevisions, labelOf, referenceRead } from "../generated.js";
import { hooksOf } from "../hooks.js";
import { keywordLeg } from "../keyword/leg.js";
import { originsFor } from "../originals/reads.js";
import { precisionField, precisionsOf } from "../precision.js";
import { vectorSpaceFor } from "../vector-space.js";
import { pageOf, readOffPages, revisionTexts } from "./by-id.js";
import { noteLegRanks } from "./leg-ranks.js";
import type { Row, WindowRead } from "./leg-types.js";
import type { PassageHit, PassageSearch, PassageSearchOptions } from "./types.js";
import { passageTieOrder, vectorLegTold } from "./vector.js";

/** No search returns more than this many passages. */
const LIMIT_MAX = 200;

/**
 * Age inside each leg: a decaying read asks each relevance leg for twice its page, so a near newer row just past the
 * cut can rise into it, re-sorts by relevance × retention, and keeps the page. The recency leg is an order by time
 * already and is left alone.
 */
function decayOf(
  opts: Pick<PassageSearchOptions, "decayFrom" | "decayDays" | "decayFloor">,
  limit: number,
) {
  if (opts.decayFrom === undefined) return null;
  const from = opts.decayFrom;
  return (rows: Row[]) =>
    decayed(rows, from, { days: opts.decayDays as number, floor: opts.decayFloor as number }).slice(
      0,
      limit,
    );
}

type Fence = NonNullable<Awaited<ReturnType<typeof fence>>>;
type Fused = { row: Row; score: number; legs: string[] }[];
type Legs = { leg: "vector" | "keyword"; rows: Row[] }[];

/**
 * `passages.search`: the verbatim tier. Every leg applies the fence in its WHERE clause before its ORDER BY. The vector
 * leg runs under `VECTOR_LEG_SETTINGS`; the lexical leg is a narrow pass then a wide one, and a pass cut by its timeout
 * is reported in `degraded` rather than failing the search. The BM25 sidecar is the keyword leg when configured, every
 * hit re-read under the fence, with Postgres as its fallback. With record filters the sidecar is not asked, since a
 * filter applied after its top-k would page through documents it then discards; the lexical leg carries them instead.
 */
export async function searchPassages(
  context: ReadContext,
  viewer: Viewer,
  { query, ...opts }: PassageSearchOptions & { query: string },
): Promise<PassageSearch> {
  const filters = opts.filters ?? {};
  // `containers` narrows the reader before any leg runs: every leg carries it, and nothing is cut after a top-k.
  const reader = await fence(context, viewer, filters.containers);
  // A recency question with no topic is answered by the clock alone.
  if (!reader || (query.trim() === "" && opts.order !== "recent"))
    return { hits: [], degraded: [], bounded: false };
  const limit = Math.min(Math.max(1, opts.limit ?? 24), LIMIT_MAX);
  const degraded: string[] = [];
  const window: WindowRead = { scanned: false };
  const { legs, recency, keyword } = await legsRead(context, {
    reader,
    query,
    opts,
    limit,
    shared: { degraded, window },
  });
  const fused = fusedPage(legs, recency, limit);
  const hits = await hitsOf(context, { reader, fused, spans: opts.spans !== false });
  noteLegRanks(legs, fused, hits);
  const lost = [...degraded, ...(keyword?.degraded ?? [])];
  return { hits, degraded: lost, bounded: hits.length >= limit || window.scanned };
}

/** The vector, keyword and recency legs, run together over one fence, filters and query. */
/** One search's legs: its fence, query and options, its page, and what every leg adds to (`degraded`, `window`). */
type LegsAsk = {
  reader: Fence;
  query: string;
  opts: PassageSearchOptions;
  limit: number;
  shared: { degraded: string[]; window: WindowRead };
};

async function legsRead(context: ReadContext, ask: LegsAsk) {
  const { reader, query, opts, limit, shared } = ask;
  const recent = opts.order === "recent";
  const timeAlone = recent && opts.timeAlone === true;
  const decay = decayOf(opts, limit);
  const legLimit = decay ? Math.min(limit * 2, LIMIT_MAX) : limit;
  const read = await legRead(context, ask);
  const index = hooksOf(context).keyword;
  const worded = query.trim() !== "" && !timeAlone;
  const [vector, keyword, recency] = await Promise.all([
    opts.mode === "keyword" || !worded
      ? null
      : vectorLegTold(context, {
          ...read,
          limit: legLimit,
          space: await vectorSpaceFor(context, reader.orgId, opts.embedder),
          window: shared.window,
        }),
    opts.mode === "vector" || !worded
      ? null
      : keywordLeg(context, {
          ...read,
          limit: legLimit,
          boundedRecall: opts.bounded === true,
          bestPassage: opts.bestPassage !== false,
          decay,
          page: limit,
        }),
    recent
      ? index.recent(context, { ...read, limit, rareTopic: timeAlone && opts.rareTerms === true })
      : null,
  ]);
  const legs: Legs = [
    ...(vector ? [{ leg: "vector" as const, rows: decay ? decay(vector) : vector }] : []),
    ...(keyword ? [{ leg: "keyword" as const, rows: keyword.rows }] : []),
  ];
  return { legs, recency, keyword };
}

/**
 * What every leg reads: one fence, filters and query; the keyword leg returns its `degraded`, the rest add to it. Under
 * the workspace's `header` context the lexical legs rank by what situates each passage as well as its words: a context
 * moves rank, never which rows are read or what is quoted.
 */
async function legRead(context: ReadContext, { reader, query, opts, shared }: LegsAsk) {
  const contextual = readsPassageContext(await passageContextMode(context.sql, reader.orgId));
  const { filters: added } = hooksOf(context);
  const filters = opts.filters ?? {};
  return { fence: reader, query, filters, added, contextual, degraded: shared.degraded };
}

/**
 * Recency is an order, not a leg to fuse. Fused with the others it would be one more vote for a row that happens to be
 * new; asked for, it is the answer, and the fused lists only narrow which rows are eligible.
 */
function fusedPage(legs: Legs, recency: Row[] | null, limit: number): Fused {
  if (!recency) return fuse(legs, (r) => r.id, { tieBreak: passageTieOrder }).slice(0, limit);
  return (
    legs.length === 0
      ? recency
      : recency.filter((r) => legs.some((l) => l.rows.some((row) => row.id === r.id)))
  )
    .slice(0, limit)
    .map((row) => ({ row, score: 1, legs: ["recent"] }));
}

/**
 * Lookups over rows the fence already admitted, in parallel. None can empty the page: an origin failing costs the
 * grouping, `agentWritten` failing marks every row generated.
 */
async function lookups(context: ReadContext, ask: { reader: Fence; fused: Fused; spans: boolean }) {
  const { reader, fused } = ask;
  const eventIds = fused.map((f) => f.row.event_id);
  const { sql } = context;
  const [spans, origins, generated, reference, instructionLike, precision, readOff] =
    await Promise.all([
      ask.spans ? revisionTexts(sql, reader, eventIds) : Promise.resolve(new Map<string, string>()),
      // Which ORIGINAL each record copies: two hits sharing one origin are one message delivered twice.
      originsFor(sql, reader.orgId, eventIds).catch(() => {
        // swallowed: an origin is presentation — which copies are one message — and never a
        // fence input. Losing it costs the grouping on the page, never the page.
        return new Map<string, string>();
      }),
      agentWritten(sql, reader.orgId, eventIds),
      referenceRead(sql, hooksOf(context).reading, { orgId: reader.orgId, ids: eventIds }),
      instructionLikeRevisions(sql, reader.orgId, eventIds),
      precisionsOf(sql, reader.orgId, eventIds),
      readOffPages(
        sql,
        reader.orgId,
        fused.map((f) => f.row.id),
      ),
    ]);
  return { spans, origins, generated, reference, instructionLike, precision, readOff };
}

/** The page's hits, each located in its record and marked by what the lookups found. */
async function hitsOf(
  context: ReadContext,
  ask: { reader: Fence; fused: Fused; spans: boolean },
): Promise<PassageHit[]> {
  const found = await lookups(context, ask);
  return ask.fused.map(({ row, score, legs }): PassageHit => {
    const text = found.spans.get(row.event_id);
    const origin = found.origins.get(row.event_id);
    return {
      kind: "passage",
      recordId: row.event_id,
      // Read off an image: its words are not the record's text, so there is no span to find in it.
      span: text === undefined || found.readOff.has(row.id) ? null : locateQuote(text, row.text),
      speaker: { entityId: null, label: null, author: row.author },
      occurredAt: new Date(row.occurred_at).toISOString(),
      ...precisionField(found.precision, row.event_id),
      container: row.container,
      text: row.text,
      entityIds: [],
      ...(origin === undefined ? {} : { origin }),
      ...(found.generated.has(row.event_id) ? { generated: true as const } : {}),
      ...(found.reference.has(row.event_id) ? { reading: "reference" as const } : {}),
      ...pageOf(found.readOff, row.id),
      ...labelOf(found.instructionLike, row.event_id),
      passageId: row.id,
      seq: row.seq,
      score,
      legs: legs as PassageHit["legs"],
    };
  });
}
