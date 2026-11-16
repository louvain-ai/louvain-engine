import type { Host, ReadableSetResolver } from "@louvain/engine-core";
import type { Sql } from "postgres";
import { sanitizeId } from "../store/ids.js";

/**
 * The open build's readable-set resolver over a pool: the containers `readable_container` holds for this principal in
 * this org, and nothing else. No room fence, no extra restrictions and no permission service: a principal with no rows
 * reads nothing. The rows are written directly by the projection writer (`projection-rows.ts`).
 */
export const openReadableSet = (sql: Sql): ReadableSetResolver => ({
  async readableSet(principal, orgId) {
    const rows = await sql<{ container: string }[]>`
      select container from readable_container
      where org_id = ${orgId}::uuid and principal_id = ${sanitizeId(principal)}
      order by container`;
    return rows.map((row) => row.container);
  },
  admitted: () => [],
});

/**
 * The open build's host over a pool, which an open entry hands `createEngine`: whose set a fence reads, and no work
 * queue (a plain transaction).
 */
export const openHost = (sql: Sql): Host => ({ readableSet: openReadableSet(sql) });
