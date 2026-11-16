import type { SourceSummary } from "@louvain/engine-core";
import type { ReadContext } from "../fence.js";
import { hooksOf } from "../hooks.js";
import { type Owner, type Scope, type SourceRow, scope, summary } from "./core.js";
import { documentFence, sourceJoin, summaryColumns } from "./join.js";

/** A read by id: readable versions, fenced exactly as a listing is, and one source whichever id names it. */
export async function sourceRows(
  context: ReadContext,
  s: Scope,
  ids: string[],
): Promise<SourceSummary[]> {
  if (!ids.length) return [];
  const { detail, filters } = hooksOf(context);
  const { sql } = context;
  const rows = await sql<SourceRow[]>`select ${summaryColumns(sql, s, filters)} ${sourceJoin(sql)}
    where ${documentFence(sql, s, "unnest")} and r.event_id = any(${ids}::text[]) order by r.modified_at desc, r.event_id`;
  return rows.map((row) => summary(row, detail.byline));
}

/** The readable subset, by version — for a list that drops what the viewer may not see. */
export async function readableSources(
  context: ReadContext,
  owner: Owner,
  versionIds: string[],
): Promise<Map<string, SourceSummary>> {
  const rows = await sourceRows(context, await scope(context, owner), [...new Set(versionIds)]);
  return new Map(rows.map((row) => [row.versionId, row]));
}
// One source, whichever of its ids was handed over, lives in `resolve.ts`.
export { resolveSource } from "./resolve.js";
