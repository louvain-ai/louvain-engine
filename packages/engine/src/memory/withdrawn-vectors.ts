import type { Queryable } from "../kg/core/sql.js";

/**
 * What every withdrawal does to vectors, in its own transaction before the event rows go: a document's embedding has
 * no foreign key to its event, so it is deleted by its key, and the withdrawn records' other versions' dropped
 * passages are marked for recheck.
 */
export async function forgetVectorsOf(
  trx: Queryable,
  orgId: string,
  ids: readonly string[],
): Promise<void> {
  await trx`
    delete from document_embedding
    where org_id = ${orgId} and event_id = any(${[...ids]}::text[])`;
  await markForRecheck(trx, orgId, ids);
}

/**
 * A newer version is going: every dropped passage of the same records' other versions is marked, so from the commit a
 * read that may now want one is told, and the recheck finds its work by index. The mark sets both times to `infinity`,
 * a literal the planner matches to the partial index, so `superseded_valid_from > <instant>` holds at every instant.
 */
async function markForRecheck(
  trx: Queryable,
  orgId: string,
  victims: readonly string[],
): Promise<void> {
  if (victims.length === 0) return;
  await trx`
    update passage p
       set superseded_valid_from = 'infinity', superseded_known_from = 'infinity'
      from event_log v
      join event_log o on o.org_id = v.org_id and o.connector = v.connector and o.workspace = v.workspace
       and o.record_key = v.record_key and o.kind = 'record.change' and o.connection_id = v.connection_id
     where v.org_id = ${orgId} and v.id = any(${[...victims]}::text[]) and v.kind = 'record.change'
       and v.record_key is not null and o.id <> all(${[...victims]}::text[])
       and p.event_id = o.id and p.org_id = o.org_id and p.vector_dropped_at is not null`;
}
