import type { Sql } from "postgres";
import type { HeldEvent } from "./holdings-types.js";

/**
 * Path-keyed documents: the `http`/`folder` feed, one for every folder, keyed by path with no record key, so no run
 * can update or withdraw them. A folder's first run into a collection replaces each one of the same path AND
 * the same words, and withdraws it, so nothing is held twice; any other is another folder's, or not this file, and stays.
 */
const LEGACY = { connector: "http", workspace: "folder" } as const;

/** Whether the store holds any path-keyed document: one seek of its feed's idempotency index. */
export async function legacyHeld(sql: Sql, orgId: string): Promise<boolean> {
  const [row] = await sql<{ one: number }[]>`
    -- fence-ok: the path-keyed feed, found to be replaced; it serves no reader
    select 1 as one from event_log
     where org_id = ${orgId} and connector = ${LEGACY.connector} and workspace = ${LEGACY.workspace}
     limit 1`;
  return row !== undefined;
}

/** The earlier loader's events for one path whose words hash to `hash`, as the withdrawal takes them. */
export async function legacyOf(
  sql: Sql,
  orgId: string,
  key: string,
  hash: string,
): Promise<HeldEvent[]> {
  const rows = await sql<{ id: string }[]>`
    -- fence-ok: the earlier loader's own records, by the key it gave them (the path) and their words, to be replaced
    select e.id from event_log e join source_revision r on r.event_id = e.id
     where e.org_id = ${orgId} and e.connector = ${LEGACY.connector} and e.workspace = ${LEGACY.workspace}
       and e.idempotency_key = ${key} and e.record_key is null and r.content_hash = ${hash}`;
  return rows.map((r) => ({
    id: r.id,
    connector: LEGACY.connector,
    workspace: LEGACY.workspace,
    recordKey: "",
  }));
}
