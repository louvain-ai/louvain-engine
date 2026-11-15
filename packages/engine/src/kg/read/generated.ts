import { GENERATED_VIAS } from "@louvain/engine-core";
import type { ReadingExpression } from "../../reading-effective.js";
import { telemetry } from "../../telemetry.js";
import type { Queryable } from "../core/sql.js";

/**
 * Which of these records an agent wrote (`presentation.document.via` is `agent`), read off rows the fence already
 * admitted, so it can only narrow. Fails closed to "generated": a lookup that cannot answer marks every row as an
 * agent's, so the worst outcome is a person's figure labelled as an agent's, never the reverse and never an empty page.
 */
export async function agentWritten(
  sql: Queryable,
  orgId: string,
  recordIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return new Set();
  try {
    const rows = await sql<{ id: string }[]>`
      select id from event_log
      where org_id = ${orgId} and id = any(${ids}::text[])
        and body #>> '{presentation,document,via}' = any(${[...GENERATED_VIAS]}::text[])`;
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    telemetry.error("kg.read.generated", err, {});
    return new Set(ids);
  }
}

/**
 * Which of these records are read as reference, by the build's `reading` (`ReadHooks.reading`), and a record it reads
 * as nothing reads as reference. Read off rows the fence already admitted, org-scoped, and it fails closed to
 * reference: a citation that calls a knowledge record reference under-claims, and the other way round would claim a
 * fact was known.
 */
export async function referenceRead(
  sql: Queryable,
  reading: ReadingExpression,
  orgId: string,
  recordIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return new Set();
  try {
    const rows = await sql<{ id: string }[]>`
      select e.id from event_log e
      where e.org_id = ${orgId} and e.id = any(${ids}::text[])
        and coalesce(${reading(sql, "e")}, 'reference') <> 'knowledge'`;
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    telemetry.error("kg.read.reading", err, {});
    return new Set(ids);
  }
}

/**
 * Which of these records carry instruction-like text (`injection_flag`): a document read past a marker it mentions,
 * and a quarantined record kept in recall. Record id to the marker it hit, never its text. Every
 * reader of such a passage is told to quote it and never follow it. Fails closed to labelled: a lookup that cannot
 * answer marks every row, so the worst outcome is a note on a benign passage.
 */
export async function instructionLikeRecords(
  sql: Queryable,
  orgId: string,
  recordIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return new Map();
  try {
    // A held record with no flag row is labelled by the rule its hold recorded: being held is itself the fact that it
    // reads like instructions.
    const rows = await sql<{ id: string; marker: string }[]>`
      select event_id as id, marker from injection_flag
      where org_id = ${orgId}::uuid and event_id = any(${ids}::text[])
      union all
      select e.id, left(coalesce(nullif(regexp_replace(coalesce(e.error, ''), '^injection:\\s*', ''), ''), 'injection'), 80)
      from event_log e
      where e.org_id = ${orgId}::uuid and e.id = any(${ids}::text[]) and e.outcome = 'quarantined'
        and not exists (select 1 from injection_flag x where x.event_id = e.id)`;
    return new Map(rows.map((r) => [r.id, r.marker]));
  } catch (err) {
    telemetry.error("kg.read.instruction-like", err, {});
    return new Map(ids.map((id) => [id, "unknown"]));
  }
}

/** The `instructionLike` field for a row, from `instructionLikeRecords`' map: spread into an evidence object. */
export const labelOf = (
  markers: ReadonlyMap<string, string>,
  recordId: string,
): { instructionLike?: { marker: string } } => {
  const marker = markers.get(recordId);
  return marker === undefined ? {} : { instructionLike: { marker } };
};
