import {
  DEFAULT_READER,
  type Grants,
  type Host,
  type ReadableSetResolver,
} from "@louvain/engine-core";
import type { Sql } from "postgres";
import { collectionOf } from "../ingest/item-feed.js";
import { sanitizeId } from "../store/ids.js";

/**
 * The projection's resolver over a pool: the containers `readable_container` holds for this principal in this org, and
 * nothing else. The loader writes the default reader's rows, every container it loads (`ingest/load.ts`); a principal
 * with no rows reads nothing.
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
 * The engine's own host over a pool, which an entry hands `createEngine`: whose set a fence reads, and no work queue
 * (a plain transaction). The default reader reads every collection loaded; a reader `grants` names reads the loaded
 * collections granted to it; anyone else reads nothing.
 */
export const openHost = (sql: Sql, grants: Grants): Host => ({
  readableSet: granted(openReadableSet(sql), grants),
});

/**
 * Each named reader's set: the default reader's, kept to the collections its grant names. A grant names a collection,
 * so a folder loaded into it later is read by its grantees with nothing written for them.
 */
export function granted(loaded: ReadableSetResolver, grants: Grants): ReadableSetResolver {
  const collections = new Map(Object.entries(grants).map(([reader, c]) => [reader, new Set(c)]));
  return {
    async readableSet(principal, orgId) {
      if (principal === DEFAULT_READER) return loaded.readableSet(principal, orgId);
      const grant = collections.get(principal);
      if (!grant?.size) return [];
      const every = await loaded.readableSet(DEFAULT_READER, orgId);
      return every.filter((container) => {
        const collection = collectionOf(container);
        return collection !== null && grant.has(collection);
      });
    },
    admitted: () => [],
  };
}
