/**
 * The keyword index, rebuilt from what is loaded: every content record's keyword entry is written again through the
 * one index stage (`indexOpen`), into the keyword sidecar's emptied index, so it holds what this release's analyzer
 * indexes; a document's current revision writes the document's entry with its own (`read/listing/keyword-documents.ts`).
 * Passages are kept as they are; a record already indexed writes no passage again. A record the sidecar misses is
 * tried again, three passes in all; one that still misses is handed back by id.
 */
import { indexOpen, OpenIndexMissing } from "../ingest/indexer.js";
import { type Writes, writeHooksOf } from "../ingest/writes.js";
import { workspaceIdOf } from "../store/tenant.js";

/** How many times a record the keyword index missed is tried. */
export const PASSES = 3;

/** No keyword index to rebuild: `LOUVAIN_BM25_URL` names none. */
export class NoKeywordIndex extends Error {
  constructor() {
    super("no keyword index is configured (LOUVAIN_BM25_URL).");
  }
}

export async function reindexKeywords(
  writes: Writes,
): Promise<{ indexed: number; missed: string[] }> {
  if (!writeHooksOf(writes).keyword.endpoint.configured()) throw new NoKeywordIndex();
  const { sql } = writes;
  const orgId = await workspaceIdOf(sql);
  await sql`update event_log set keyword_indexed_at = null where org_id = ${orgId}`;
  const records = await sql<
    { id: string }[]
  >`select id from event_log where org_id = ${orgId} order by id`;
  let indexed = 0;
  let pending = records.map((r) => r.id);
  for (let pass = 0; pass < PASSES && pending.length > 0; pass++) {
    const missed: string[] = [];
    for (const id of pending) {
      const keyword = await keywordOf(writes, orgId, id);
      if (keyword === "indexed") indexed++;
      if (keyword === "missed") missed.push(id);
    }
    pending = missed;
  }
  return { indexed, missed: pending };
}

/** What the index stage did with one record's keyword entry; a record that is not content has none. */
async function keywordOf(writes: Writes, orgId: string, id: string): Promise<string | null> {
  try {
    return (await indexOpen(writes, orgId, [id]))[0]?.keyword ?? null;
  } catch (err) {
    // Not a content record (a withdrawal, a permission change): nothing of it is in the keyword index.
    if (!(err instanceof OpenIndexMissing)) throw err;
    return null;
  }
}
