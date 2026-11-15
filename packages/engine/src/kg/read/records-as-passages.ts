import type { Viewer } from "@louvain/engine-core";
import { recordsInNarrowing } from "./bm25/records-in-narrowing.sql.js";
import { instantOf } from "./context.js";
import { firstChunkRows } from "./document-rows.js";
import { bounded, fence, type ReadContext } from "./fence.js";
import type { RecordFilters } from "./filters.js";
import { hooksOf } from "./hooks.js";
import { passagesById } from "./passages-by-id.js";
import { stillCurrent } from "./passages-filter.js";
import type { PassageFilters, PassageRead } from "./passages-types.js";

/** Records named by id, and the search they are read for: its as-of and its narrowing. */
export type RecordsAsk = {
  recordIds: readonly string[];
  asOf?: PassageFilters["asOf"];
  narrow?: RecordFilters & { containers?: string[] };
};

/**
 * Records named by id, read as the keyword index's hits are (`keyword/rows.ts`): under the viewer's fence narrowed to
 * the search's collections, only a record whose version is current as of the search (`stillCurrent`), only those every
 * narrowing keeps (`recordsInNarrowing`), each by its first readable passage (`firstChunkRows`), read back by id under
 * the fence (`passagesById`), so every word, date and place on a page is the engine's own. What a retriever with an
 * index of its own hands back is read here; an id it cannot read is absent.
 */
export async function recordsAsPassages(
  context: ReadContext,
  viewer: Viewer,
  ask: RecordsAsk,
): Promise<Map<string, PassageRead>> {
  const { containers, ...filters } = ask.narrow ?? {};
  const reader = await fence(context, viewer, containers);
  const ids = [...new Set(ask.recordIds)];
  if (!reader || ids.length === 0) return new Map();
  const current = await stillCurrent(context, reader, ids, ask.asOf);
  const kept = await bounded(context, (q) =>
    recordsInNarrowing(q, reader.orgId, {
      ids: ids.filter((id) => current.has(id)),
      filters,
      added: hooksOf(context).filters,
    }),
  );
  const first = await firstChunkRows(context.sql, hooksOf(context).reading, {
    orgId: reader.orgId,
    eventIds: kept.map((r) => r.id),
    containers: reader.containers,
    asOf: instantOf(ask.asOf, "passages.search").validAt,
  });
  const { passages } = await passagesById(
    context,
    viewer,
    [...first.values()].map((r) => r.id),
  );
  return new Map(passages.map((p) => [p.recordId, p]));
}
