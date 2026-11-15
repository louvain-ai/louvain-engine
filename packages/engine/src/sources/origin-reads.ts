/**
 * The group each event's document belongs to, for rows a reader has already fenced. Each reads only the document a
 * fenced event belongs to, never a sibling, so it widens nothing: an event with no keyed document is absent.
 */
import type { Queryable } from "../kg/core/sql.js";
import { originColumn } from "./opaque.js";

/** The opaque origin of each event's document. */
export async function originsFor(
  sql: Queryable,
  orgId: string,
  eventIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return new Map();
  const rows = await sql<{ event_id: string; origin: string }[]>`
    select r.event_id, ${originColumn(sql, "d")} as origin
    from source_revision r join source_document d on d.id = r.source_id
    where d.org_id = ${orgId} and r.event_id = any(${ids}::text[]) and d.origin_key is not null`;
  return new Map(rows.map((row) => [row.event_id, row.origin]));
}
