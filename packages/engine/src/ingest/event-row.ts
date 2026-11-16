import { documentKeyOf, isContentKind } from "@louvain/engine-core";
import type { TransactionSql } from "postgres";
import { occurredPrecisionOf } from "./event-fields.js";
import type { Revision } from "./revision.js";

/**
 * An open event's row: the revision as it arrived, deduplicated by one statement, `on conflict do nothing` on the event
 * id or the per-feed key (org, connector, workspace, idempotency key). The open ingest has no queue, so the row carries
 * no lease, claim or reading state: content waits only to be indexed (`index_status`), which `indexer.ts` settles.
 * Whether the event may be written at all is the caller's.
 */
export type EventRow = {
  ev: Revision;
  orgId: string;
  /** The sanitised workspace, as every per-feed key stores it. */
  workspace: string;
  container: string;
};

/**
 * The advisory lock name of one record of one feed: every accept, withdrawal and relocation of the record takes it
 * (`accept.ts`, `withdraw.ts` `lockRecords`), so they serialise against each other.
 */
export function documentLockName(
  orgId: string,
  k: { connector: string; workspace: string; recordKey: string },
): string {
  return `record:${orgId}|${k.connector}|${k.workspace}|${k.recordKey}`;
}

/**
 * Insert the row; false when its key or id is already held (a duplicate). It keeps the name the source showed for the
 * actor and whether the author relays. Deduplication is per org, from the source's own ids. No conflict target: naming
 * one would tie the statement to one index; both constraints that fire mean a duplicate.
 */
export async function insertRevisionRow(trx: TransactionSql, row: EventRow): Promise<boolean> {
  const { ev, orgId, workspace, container } = row;
  const inserted = await trx`
      insert into event_log
        (id, idempotency_key, connector, workspace, container, kind,
         occurred_at, occurred_precision, observed_at, actor_id, actor_email, actor_display_name, actor_relays, body,
         visibility, org_id, record_key, parent_ids, index_status)
      values
        (${ev.id}, ${ev.idempotencyKey}, ${ev.source.connector}, ${workspace},
         ${container}, ${ev.kind}, ${ev.occurredAt}, ${occurredPrecisionOf(ev)}, ${ev.observedAt},
         ${ev.actor.sourceUserId}, ${ev.actor.email ?? null},
         ${ev.actor.displayName ?? null},
         ${ev.actor.relays ?? false},
         ${trx.json(ev.body as never)},
         ${ev.permissions.visibility}, ${orgId}, ${documentKeyOf(ev)},
         ${ev.record?.parents ?? null},
         ${isContentKind(ev.kind) ? "pending" : "done"})
      on conflict do nothing
      returning id`;
  return inserted.length > 0;
}
