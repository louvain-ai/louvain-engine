import type { ItemPrecision } from "@louvain/engine-core";
import type { Queryable } from "../core/sql.js";

export type KnownPrecision = Exclude<ItemPrecision, "instant">;

/**
 * How much of each record's `occurred_at` its source knew, for a page of rows already read through the fence: one
 * primary-key read, returning only records whose precision is not the whole instant. It widens nothing, since the ids
 * are rows the caller may already read: a decoration, like a record's author.
 */
export async function precisionsOf(
  sql: Queryable,
  orgId: string,
  recordIds: Iterable<string>,
): Promise<Map<string, { precision: KnownPrecision; occurredAt: string }>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return new Map();
  const rows = await sql<{ id: string; occurred_precision: KnownPrecision; occurred_at: Date }[]>`
    select id, occurred_precision, occurred_at from event_log
    where org_id = ${orgId} and id = any(${ids}::text[]) and occurred_precision is not null`;
  return new Map(
    rows.map((r) => [
      r.id,
      { precision: r.occurred_precision, occurredAt: new Date(r.occurred_at).toISOString() },
    ]),
  );
}

/** A row's `occurredPrecision` field when its record's date is not the whole instant, else nothing. */
export function precisionField(
  known: ReadonlyMap<string, { precision: KnownPrecision }>,
  recordId: string,
): { occurredPrecision?: KnownPrecision } {
  const k = known.get(recordId);
  return k === undefined ? {} : { occurredPrecision: k.precision };
}
