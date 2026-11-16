import type { Sql, TransactionSql } from "postgres";
import type { Collection, HeldRevision } from "./holdings-types.js";

/**
 * Tombstones, for the sources that send changes rather than a whole listing. A withdrawal deletes the rows it
 * retires, so each retired revision is kept with the time its source stated for it; the same revision arriving again
 * is a replay, refused unless it states a later time. They are kept `KEEP_DAYS`: an older replay is not refused.
 */
type Retired = { revision: string; statedAt: Date | null };

const KEEP_DAYS = 90;

/** The retired revisions of these keys, by key; a collection's tombstones past `KEEP_DAYS` go first. */
export async function retiredOf(
  sql: Sql,
  collection: Collection,
  keys: readonly string[],
): Promise<Map<string, Retired[]>> {
  await sql`delete from ingest_retired
    where org_id = ${collection.orgId} and collection = ${collection.name}
      and retired_at < now() - make_interval(days => ${KEEP_DAYS})`;
  const rows = await sql<{ item_key: string; revision: string; stated_at: Date | null }[]>`
    select item_key, revision, stated_at
      from ingest_retired
     where org_id = ${collection.orgId} and collection = ${collection.name} and item_key = any(${[...keys]}::text[])`;
  const out = new Map<string, Retired[]>();
  for (const r of rows)
    out.set(r.item_key, [
      ...(out.get(r.item_key) ?? []),
      { revision: r.revision, statedAt: r.stated_at },
    ]);
  return out;
}

/** Records each revision as retired, inside the caller's transaction; one retired again keeps its later time. */
export async function recordRetired(
  trx: TransactionSql,
  collection: Collection,
  revisions: readonly HeldRevision[],
): Promise<void> {
  if (revisions.length === 0) return;
  const rows = revisions.map((r) => ({
    key: r.key,
    revision: r.revision,
    at: r.statedAt?.toISOString() ?? null,
  }));
  await trx`
    insert into ingest_retired (org_id, collection, item_key, revision, stated_at)
    select ${collection.orgId}::uuid, ${collection.name}, r.key, r.revision, r.at::timestamptz
      from jsonb_to_recordset(${trx.json(rows)}) as r(key text, revision text, at text)
    on conflict (org_id, collection, item_key, revision)
    do update set stated_at = greatest(ingest_retired.stated_at, excluded.stated_at), retired_at = now()`;
}

/** Whether an arrival of this revision replays one already retired: true unless it states a later time. */
export function replays(
  revision: string,
  statedAt: Date | null,
  retired: readonly Retired[] = [],
): boolean {
  return retired.some(
    (r) => r.revision === revision && !(statedAt && (r.statedAt === null || statedAt > r.statedAt)),
  );
}
