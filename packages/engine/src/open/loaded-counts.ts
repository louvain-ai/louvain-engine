import type { Sql } from "postgres";
import { openOrgId } from "./org.js";

/** What is loaded: how many documents, in which collections (a loaded folder's subfolders; "." is its top level). */
export type LoadedCounts = {
  documents: number;
  collections: { name: string; documents: number }[];
};

export async function loadedCounts(sql: Sql): Promise<LoadedCounts> {
  const orgId = await openOrgId(sql);
  const rows = await sql<{ name: string; documents: number }[]>`
    -- fence-ok: the open build's one reader reads every document loaded; this counts them by the loader's container
    select coalesce(substring(native_id from '^(.*)/[^/]*$'), '.') as name, count(*)::int as documents
    from source_document where org_id = ${orgId}
    group by 1 order by 1`;
  return { documents: rows.reduce((n, r) => n + r.documents, 0), collections: [...rows] };
}
