import { decayed, fuse, type Viewer } from "@louvain/engine-core";
import { originsFor } from "../../sources/origin-reads.js";
import { locateQuote } from "../packages/lib/text.js";
import { fence, type ReadContext } from "./fence.js";
import { agentWritten, instructionLikeRecords, labelOf, referenceRead } from "./generated.js";
import { hooksOf } from "./hooks.js";
import { keywordLeg } from "./keyword/leg.js";
import { noteLegRanks } from "./leg-ranks.js";
import { passageContextMode, readsPassageContext } from "./passage-context-mode.js";
import { pageOf, readOffPages, recordTexts } from "./passages-by-id.js";
import type {
  PassageHit,
  PassageSearch,
  PassageSearchOptions,
  Row,
  WindowRead,
} from "./passages-types.js";
import { passageTieOrder, vectorLegTold } from "./passages-vector.js";
import { precisionField, precisionsOf } from "./precision.js";
import { vectorSpaceFor } from "./space.js";

export type { Neighbour } from "./passages-around.js";
export { passagesAround } from "./passages-around.js";
export { passagesById } from "./passages-by-id.js";
export type {
  PassageFilters,
  PassageHit,
  PassageRead,
  PassageSearch,
  PassageSearchOptions,
} from "./passages-types.js";

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
  query: string,
  opts: PassageSearchOptions,
): Promise<PassageSearch> {
  const filters = opts.filters ?? {};
  // `containers` narrows the reader before any leg runs: every leg carries it, and nothing is cut after a top-k.
  const reader = await fence(context, viewer, filters.containers);
  const recent = opts.order === "recent";
  // A recency question with no topic is answered by the clock alone.
  if (!reader || (query.trim() === "" && !recent))
    return { hits: [], degraded: [], bounded: false };
  const limit = Math.min(Math.max(1, opts.limit ?? 24), LIMIT_MAX);
  const degraded: string[] = [];
  // Under the workspace's `header` context the lexical legs rank by what situates each passage as well as its words:
  // a context moves rank, never which rows are read or what is quoted.
  const contextual = readsPassageContext(await passageContextMode(context.sql, reader.orgId));
  const legs: { leg: "vector" | "keyword"; rows: Row[] }[] = [];
  const window: WindowRead = { scanned: false };
  const timeAlone = recent && opts.timeAlone === true;
  const decay = decayOf(opts, limit);
  const legLimit = decay ? Math.min(limit * 2, LIMIT_MAX) : limit;
  // Every leg reads one fence, filters and query; the keyword leg returns its `degraded`, the rest add to it.
  const { filters: added, reading, keyword: index } = hooksOf(context);
  const read = { fence: reader, query, filters, added, contextual, degraded };
  const [vector, keyword, recency] = await Promise.all([
    opts.mode === "keyword" || query.trim() === "" || timeAlone
      ? null
      : vectorLegTold(context, {
          ...read,
          limit: legLimit,
          space: await vectorSpaceFor(context, reader.orgId, opts.embedder),
          window,
        }),
    opts.mode === "vector" || query.trim() === "" || timeAlone
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
  if (vector) legs.push({ leg: "vector", rows: decay ? decay(vector) : vector });
  if (keyword) legs.push({ leg: "keyword", rows: keyword.rows });
  /**
   * Recency is an order, not a leg to fuse. Fused with the others it would be one more vote for a row that
   * happens to be new; asked for, it is the answer, and the fused lists only narrow which rows are eligible.
   */
  const fused = recency
    ? (legs.length === 0
        ? recency
        : recency.filter((r) => legs.some((l) => l.rows.some((row) => row.id === r.id)))
      )
        .slice(0, limit)
        .map((row) => ({ row, score: 1, legs: ["recent"] }))
    : fuse(legs, (r) => r.id, { tieBreak: passageTieOrder }).slice(0, limit);
  const eventIds = fused.map((f) => f.row.event_id);
  const passageIds = fused.map((f) => f.row.id);
  // Lookups over rows the fence already admitted, in parallel. None can empty the page: an
  // origin failing costs the grouping, `agentWritten` failing marks every row generated.
  const [spans, origins, generated, reference, instructionLike, precision, readOff] =
    await Promise.all([
      opts.spans === false
        ? Promise.resolve(new Map<string, string>())
        : recordTexts(context.sql, reader, eventIds),
      // Which ORIGINAL each record copies: two hits sharing one origin are one message delivered twice.
      originsFor(context.sql, reader.orgId, eventIds).catch(() => {
        // swallowed: an origin is presentation — which copies are one message — and never a
        // fence input. Losing it costs the grouping on the page, never the page.
        return new Map<string, string>();
      }),
      agentWritten(context.sql, reader.orgId, eventIds),
      referenceRead(context.sql, reading, reader.orgId, eventIds),
      instructionLikeRecords(context.sql, reader.orgId, eventIds),
      precisionsOf(context.sql, reader.orgId, eventIds),
      readOffPages(context.sql, reader.orgId, passageIds),
    ]);
  const hits = fused.map(({ row, score, legs: found }): PassageHit => {
    const text = spans.get(row.event_id);
    const origin = origins.get(row.event_id);
    return {
      kind: "passage",
      recordId: row.event_id,
      // Read off an image: its words are not the record's text, so there is no span to find in it.
      span: text === undefined || readOff.has(row.id) ? null : locateQuote(text, row.text),
      speaker: { entityId: null, label: null, author: row.author },
      occurredAt: new Date(row.occurred_at).toISOString(),
      ...precisionField(precision, row.event_id),
      container: row.container,
      text: row.text,
      entityIds: [],
      ...(origin === undefined ? {} : { origin }),
      ...(generated.has(row.event_id) ? { generated: true as const } : {}),
      ...(reference.has(row.event_id) ? { reading: "reference" as const } : {}),
      ...pageOf(readOff, row.id),
      ...labelOf(instructionLike, row.event_id),
      passageId: row.id,
      seq: row.seq,
      score,
      legs: found as PassageHit["legs"],
    };
  });
  noteLegRanks(legs, fused, hits);
  const lost = [...degraded, ...(keyword?.degraded ?? [])];
  return { hits, degraded: lost, bounded: hits.length >= limit || window.scanned };
}
