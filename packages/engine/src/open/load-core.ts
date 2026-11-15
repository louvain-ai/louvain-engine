/**
 * The loader's org, its one reader and the reader's projection: the first time a container is seen, the projection
 * is rewritten to every container loaded, since the read path fences by it. Nothing here decides who may read: a
 * revision carries no grant. Every ingest source accepts through `acceptInto`, so there is one way in.
 */
import { sanitizeId } from "../db-ids.js";
import { acceptOpen, type OpenAcceptResult } from "../ingest/accept-open.js";
import type { Revision } from "../ingest/revision.js";
import { writeProjection } from "../kg/read/projection-rows.js";
import type { Writes } from "../writes.js";
import { OPEN_PRINCIPAL, openOrgId } from "./org.js";

/**
 * What a load knows across its events: what it writes on (the pool and the build's hooks, so it is itself what a
 * write is handed), the org, the one reader, and the containers already in that reader's projection (read once, so a
 * rerun over a loaded database does not lose any).
 */
export type LoadState = Writes & { orgId: string; principal: string; known: Set<string> };

export async function openLoadState(writes: Writes): Promise<LoadState> {
  const { sql } = writes;
  const orgId = await openOrgId(sql);
  const principal = sanitizeId(OPEN_PRINCIPAL);
  const known = new Set(
    (
      await sql<{ container: string }[]>`
        -- fence-ok: the loader's own projection rows, read back to rewrite them whole; it reads no record
        select container from readable_container where org_id = ${orgId} and principal_id = ${principal}`
    ).map((r) => r.container),
  );
  return { sql, hooks: writes.hooks, orgId, principal, known };
}

/**
 * One revision through the engine's one accept path, its container projected to the reader the first time it is seen.
 * Throws the accept path's refusal before anything is written.
 */
export async function acceptInto(state: LoadState, revision: Revision): Promise<OpenAcceptResult> {
  const accepted = await acceptOpen(state.sql, state.orgId, revision);
  await project(state, accepted.container);
  return accepted;
}

/** The one reader's projection, rewritten to every container loaded the first time `container` is seen. */
export async function project(state: LoadState, container: string): Promise<void> {
  if (state.known.has(container)) return;
  state.known.add(container);
  await state.sql.begin((trx) =>
    writeProjection(trx, state.orgId, state.principal, [...state.known]),
  );
}
