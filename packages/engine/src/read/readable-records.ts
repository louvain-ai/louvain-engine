import type { Viewer } from "@louvain/engine-core";
import { fence, type ReadContext } from "./fence.js";
import { fenced } from "./fenced.js";

/** The records to check, and the search's collections to narrow the fence to. */
export type ReadableRevisionsAsk = {
  recordIds: readonly string[];
  containers?: readonly string[] | undefined;
};

/**
 * Which of these records the viewer may read, by id, under the viewer's fence narrowed to the search's collections:
 * the check a search makes on every row a retriever hands back, before fusion. A retriever that reads under the fence
 * returns only these; one that does not has its other rows dropped here. Bounded by the ids asked, by the primary key.
 */
export async function readableRevisions(
  context: ReadContext,
  viewer: Viewer,
  { recordIds, containers }: ReadableRevisionsAsk,
): Promise<Set<string>> {
  const { sql } = context;
  const ids = [...new Set(recordIds)];
  const reader = await fence(context, viewer, containers);
  if (!reader || ids.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    select id from event_log
     where org_id = ${reader.orgId} and id = any(${ids}::text[])
       and ${fenced(sql, reader, { column: sql`container`, record: sql`id` })}`;
  return new Set(rows.map((r) => r.id));
}
