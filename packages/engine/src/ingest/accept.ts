import { documentKeyOf } from "@louvain/engine-core";
import type { Sql, TransactionSql } from "postgres";
import { containerId, sanitizeId } from "../store/ids.js";
import { documentLockName, insertRevisionRow } from "./event-row.js";
import { readOpenPresentation } from "./presentation.js";
import type { Revision } from "./revision.js";
import { documentEntries, writeDocumentRows } from "./source-rows.js";

/**
 * The engine's accept: one item's revision (`ingest/item-event.ts`), written as its event row, its source document
 * and its revision, the row waiting for the indexer (`indexer.ts`). An
 * item carries content only, so there is nothing else to refuse but a record already held in another collection
 * (`relocation`), which is refused rather than left readable in two places. Idempotent: a revision already held is
 * `duplicate`.
 */
export type OpenAcceptRefusal = "relocation";

export class OpenAcceptRefused extends Error {
  readonly reason: OpenAcceptRefusal;
  constructor(reason: OpenAcceptRefusal) {
    super(`the open engine does not accept this event: ${reason}`);
    this.name = "OpenAcceptRefused";
    this.reason = reason;
  }
}

export type OpenAcceptResult = {
  status: "accepted" | "duplicate";
  /** The id the record is held under: this event's when accepted, the stored event's on a duplicate. */
  eventId: string;
  container: string;
};

/**
 * Accept one revision into `orgId`. Throws `OpenAcceptRefused` (nothing written). Given a transaction, it writes inside
 * it, so a caller's other step (a move's withdrawal of the old place) and this accept commit or roll back together.
 */
export async function acceptOpen(
  sql: Sql,
  orgId: string,
  ev: Revision,
  within?: TransactionSql,
): Promise<OpenAcceptResult> {
  const one: OneEvent = {
    orgId,
    ev,
    workspace: sanitizeId(ev.source.workspace),
    container: containerId(ev.source.connector, ev.source.workspace, ev.source.container),
    recordKey: documentKeyOf(ev),
  };
  const write = (trx: TransactionSql) => writeOne(trx, one);
  const stored = within ? await write(within) : await sql.begin(write);
  return {
    status: stored.accepted ? "accepted" : "duplicate",
    eventId: stored.id,
    container: one.container,
  };
}

type OneEvent = {
  orgId: string;
  ev: Revision;
  workspace: string;
  container: string;
  recordKey: string | null;
};

/**
 * Write the event, or name the event already held for it: a folder loaded again mints new ids, and the caller indexes
 * what is stored. A record is first checked under its own lock, so one record lives in one collection.
 */
async function writeOne(
  trx: TransactionSql,
  one: OneEvent,
): Promise<{ id: string; accepted: boolean }> {
  if (one.recordKey) {
    const held = await recordHeldElsewhere(trx, one, one.recordKey);
    if (held) return { id: held, accepted: false };
  }
  const inserted = await insertRevisionRow(trx, one);
  if (!inserted) return { id: (await heldEvent(trx, one)) ?? one.ev.id, accepted: false };
  await writeDocumentRows(trx, {
    entries: documentEntries([one.ev], one.orgId, { presentation: readOpenPresentation }),
    orgId: one.orgId,
  });
  return { id: one.ev.id, accepted: true };
}

/**
 * Under the record's lock: the id of the event already held for this one (by its id or its per-feed key), or null;
 * and a refusal (`relocation`, inside the transaction, which rolls back) when the record sits in another collection.
 */
async function recordHeldElsewhere(
  trx: TransactionSql,
  one: OneEvent,
  recordKey: string,
): Promise<string | null> {
  const { orgId, ev, workspace, container } = one;
  await trx`select pg_advisory_xact_lock(hashtextextended(${documentLockName(orgId, { connector: ev.source.connector, workspace, recordKey })}, 0))`;
  const held = await heldEvent(trx, one);
  if (held) return held;
  const [elsewhere] = await trx<{ id: string }[]>`
        select id from event_log
        where org_id = ${orgId} and connector = ${ev.source.connector} and workspace = ${workspace}
          and record_key = ${recordKey} and container <> ${container}
        limit 1`;
  if (elsewhere) throw new OpenAcceptRefused("relocation");
  return null;
}

/** The event already held for this one, by its id or its per-feed key. */
async function heldEvent(trx: TransactionSql, { orgId, ev, workspace }: OneEvent) {
  const [held] = await trx<{ id: string }[]>`
        select id from event_log
        where org_id = ${orgId} and (id = ${ev.id} or (connector = ${ev.source.connector}
          and workspace = ${workspace} and idempotency_key = ${ev.idempotencyKey}))
        limit 1`;
  return held?.id ?? null;
}
