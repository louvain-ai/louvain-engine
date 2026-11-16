import type { ReadContext } from "../fence.js";
import { hooksOf } from "../hooks.js";
import { type Owner, type Scope, scope } from "./core.js";
import { documentFence, sourceJoin } from "./join.js";

/*
 * Moved here from `read-detail.ts`, verbatim: resolving an id needs no statement read, and the source tools resolve
 * every id they are handed, so they load this without the detail read's statements.
 */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedSource = { documentId: string; recordId: string };

/**
 * One source, whichever of its ids was handed over: a document id, a record id an answer cites, or a saved file's id.
 * `recordId` is the version that id names; a `version` must be one of that document's. The fence is in the SQL, so not
 * found and not permitted are one answer, `null`, and a version a reader once saw elsewhere is not theirs by its old id.
 */
export async function resolveSource(
  context: ReadContext,
  owner: Owner,
  { id, version }: { id: string; version?: string | undefined },
): Promise<ResolvedSource | null> {
  const s = await scope(context, owner);
  if (s.containers.length === 0) return null;
  const found = await documentOf(context, s, id);
  if (!found || version === undefined || version === found.recordId) return found;
  const { sql } = context;
  const [row] = await sql<ResolvedSource[]>`
    select d.id as "documentId", r.event_id as "recordId"
    ${sourceJoin(sql)} where ${documentFence(sql, s)} and d.id = ${found.documentId} and r.event_id = ${version}`;
  return row ?? null;
}

async function documentOf(
  context: ReadContext,
  s: Scope,
  id: string,
): Promise<ResolvedSource | null> {
  const { sql } = context;
  // Two keyed lookups rather than one OR, which cannot use either key's index.
  const [row] = await sql<ResolvedSource[]>`
    (select d.id as "documentId", r.event_id as "recordId"
      ${sourceJoin(sql)} where ${documentFence(sql, s)} and d.id = ${id} and r.event_id = d.current_event_id)
    union all
    (select d.id as "documentId", r.event_id as "recordId"
      ${sourceJoin(sql)} where ${documentFence(sql, s)} and r.event_id = ${id})
    limit 1`;
  if (row) return row;
  if (!UUID_SHAPE.test(id)) return null;
  // A saved file: what its id names is the build's to say (`ReadHooks.detail`); the open build has none.
  return hooksOf(context).detail.documentOfFile(s, id);
}
