import type { Viewer } from "@louvain/engine-core";
import { bounded } from "./bounded.js";
import { fence, type ReadContext } from "./fence.js";
import { fenced } from "./fenced.js";
import { notQuarantined } from "./listing/quarantine.js";

/** What a reader may read, counted: how many documents, in which collections. */
export type LoadedCounts = {
  documents: number;
  collections: { name: string; documents: number }[];
};

/**
 * How many documents the reader may read, by collection, counted under the reader's fence: a collection the reader
 * cannot read is neither named nor counted, and a reader the fence refuses reads none. A document counts by its
 * current version, as a listing shows it.
 */
export async function loadedCounts(context: ReadContext, viewer: Viewer): Promise<LoadedCounts> {
  const reader = await fence(context, viewer);
  if (!reader) return { documents: 0, collections: [] };
  const rows = await bounded(
    context,
    (q) => q<{ name: string; documents: number }[]>`
      select d.workspace as name, count(*)::int as documents
      from source_document d join event_log ce on ce.id = d.current_event_id
      where d.org_id = ${reader.orgId} and ce.org_id = ${reader.orgId}
        and ${fenced(q, reader, { column: q`ce.container`, shape: "any" })} and ${notQuarantined(q, "ce")}
      group by 1 order by 1`,
  );
  return { documents: rows.reduce((n, r) => n + r.documents, 0), collections: [...rows] };
}
