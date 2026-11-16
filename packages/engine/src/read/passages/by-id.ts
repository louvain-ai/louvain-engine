import type { Viewer } from "@louvain/engine-core";
import { telemetry } from "../../observability/telemetry.js";
import type { Queryable } from "../../store/sql.js";
import { locateQuote } from "../../text/words.js";
import { bounded, fence, type ReadContext, type Reader } from "../fence.js";
import { agentWritten, instructionLikeRecords, labelOf, referenceRead } from "../generated.js";
import { hooksOf } from "../hooks.js";
import { originsFor } from "../originals/reads.js";
import { precisionField, precisionsOf } from "../precision.js";
import { passagesWithIds } from "./by-id.sql.js";
import { readOffRows } from "./read-off-pages.sql.js";
import { recordTextRows } from "./record-texts.sql.js";
import type { PassageFilters, PassageRead } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A receipt panel shows a page of citations; past this the caller is walking, which is `search`'s job. */
const BY_ID_MAX = 200;

/**
 * Which of these passages were read off an image, from which page, and whether a vision model read it: one lookup by
 * id over rows the fence already admitted. A failure costs the label, never the page.
 */
export async function readOffPages(
  sql: Queryable,
  orgId: string,
  passageIds: readonly string[],
): Promise<Map<string, { page: number; by?: "vision" }>> {
  if (passageIds.length === 0) return new Map();
  try {
    const rows = await readOffRows(sql, orgId, passageIds);
    return new Map(
      rows.map((r) => [
        r.id,
        r.reading === "vision" ? { page: r.page, by: "vision" } : { page: r.page },
      ]),
    );
  } catch (err) {
    telemetry.error("passages.read_off", err);
    return new Map();
  }
}

export const pageOf = (
  readOff: ReadonlyMap<string, { page: number; by?: "vision" }>,
  id: string,
) => {
  const off = readOff.get(id);
  return off === undefined ? {} : { readOff: off };
};

/**
 * `passages.byId`: these passages, if this viewer may read them. A saved citation keeps only a `passageId`, so this is
 * the by-id read, fenced like any other: a passage in a container the viewer has since lost is absent (fail closed,
 * never a row saying the id exists). Nothing here takes a record from the caller, and the order is the caller's.
 */
export async function passagesById(
  context: ReadContext,
  viewer: Viewer,
  passageIds: readonly string[],
): Promise<{ passages: PassageRead[]; degraded: string[] }> {
  const reader = await fence(context, viewer);
  const ids = [...new Set(passageIds)].filter((id) => UUID.test(id)).slice(0, BY_ID_MAX);
  if (!reader || ids.length === 0) return { passages: [], degraded: [] };
  const rows = await bounded(context, (q) => passagesWithIds(q, reader, ids));
  const decorations = await decorate(context, reader, rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const passages = ids.flatMap((id): PassageRead[] => {
    const row = byId.get(id);
    return row === undefined ? [] : [byIdPassage(row, decorations)];
  });
  return { passages, degraded: [] };
}

type ByIdRow = Awaited<ReturnType<typeof passagesWithIds>>[number];
type Decorations = Awaited<ReturnType<typeof decorate>>;

/**
 * Each row's record text, origin, whether an agent wrote it, whether it is read as reference, its instruction-like
 * label, its time precision and its image page, read in parallel over rows the fence already admitted.
 */
async function decorate(context: ReadContext, fence: Reader, rows: ByIdRow[]) {
  const { sql } = context;
  const events = rows.map((r) => r.event_id);
  const [spans, origins, generated, reference, instructionLike, precision, readOff] =
    await Promise.all([
      recordTexts(sql, fence, events),
      originsFor(sql, fence.orgId, events).catch(() => {
        // swallowed: an origin is presentation (which copies are one message), never a fence input. Losing it costs
        // the grouping on the page, never the page.
        return new Map<string, string>();
      }),
      agentWritten(sql, fence.orgId, events),
      referenceRead(sql, hooksOf(context).reading, fence.orgId, events),
      instructionLikeRecords(sql, fence.orgId, events),
      precisionsOf(sql, fence.orgId, events),
      readOffPages(
        sql,
        fence.orgId,
        rows.map((r) => r.id),
      ),
    ]);
  return { spans, origins, generated, reference, instructionLike, precision, readOff };
}

/** One row as a passage, with its decorations. */
function byIdPassage(row: ByIdRow, d: Decorations): PassageRead {
  const { spans, origins, generated, reference, instructionLike, precision, readOff } = d;
  const text = spans.get(row.event_id);
  const origin = origins.get(row.event_id);
  return {
    kind: "passage",
    recordId: row.event_id,
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
  };
}

/** The hits' record texts, re-fenced, for locating each passage in its record. */
export async function recordTexts(
  sql: Queryable,
  fence: Reader,
  recordIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return new Map();
  const rows = await recordTextRows(sql, fence, ids);
  return new Map(rows.flatMap((r) => (r.text === null ? [] : [[r.id, r.text] as const])));
}
