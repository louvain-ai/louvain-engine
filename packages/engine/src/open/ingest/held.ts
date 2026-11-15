import { keyOfRecord } from "@louvain/engine-core";
import type { Sql } from "postgres";
import { bm25Configured } from "../../kg/read/bm25.js";
import { type Collection, everyEvent, type Held, type HeldEvent } from "./held-types.js";
import { ITEM_FEED, ITEM_RECORD_TYPE } from "./item-feed.js";

type HeldRow = {
  id: string;
  record_key: string;
  idempotency_key: string;
  container: string;
  stated_at: Date | null;
  indexed: boolean;
  keyworded: boolean;
};

const recordKeyOfItem = (key: string): string =>
  keyOfRecord({ objectType: ITEM_RECORD_TYPE, nativeId: key });
const keyOfRecordKey = (recordKey: string): string => recordKey.slice(ITEM_RECORD_TYPE.length + 1);
const eventOf = (collection: Collection, id: string, recordKey: string): HeldEvent => ({
  id,
  connector: ITEM_FEED,
  workspace: collection.name,
  recordKey,
});

/** What the collection holds of these keys, by key; a key it does not hold is absent. */
export async function heldOf(
  sql: Sql,
  collection: Collection,
  keys: readonly string[],
): Promise<Map<string, Held>> {
  // A time is the source's only when it stated one: an undated item is stored with precision `unknown`.
  const rows = await sql<HeldRow[]>`
    -- fence-ok: the loader's own records, read by feed and key to decide what a run changes; it serves no reader
    select e.id, e.record_key, e.idempotency_key, e.container, e.index_status = 'done' as indexed,
           e.keyword_indexed_at is not null as keyworded,
           case when e.occurred_precision = 'unknown' and r.modified_at = e.occurred_at then null
                else coalesce(r.modified_at, e.occurred_at) end as stated_at
      from event_log e left join source_revision r on r.event_id = e.id
     where e.org_id = ${collection.orgId} and e.connector = ${ITEM_FEED} and e.workspace = ${collection.name}
       and e.record_key = any(${keys.map(recordKeyOfItem)}::text[])
     order by e.record_key, upper(left(e.id, 10)), e.id`;
  const out = new Map<string, Held>();
  for (const row of rows) {
    const key = keyOfRecordKey(row.record_key);
    const before = out.get(key);
    out.set(key, { latest: latestOf(collection, row), older: before ? everyEvent(before) : [] });
  }
  return out;
}

/** A row as the item's newest event: indexed whole means its passages, and its keyword entry where one is kept. */
function latestOf(collection: Collection, row: HeldRow): Held["latest"] {
  return {
    ...eventOf(collection, row.id, row.record_key),
    key: keyOfRecordKey(row.record_key),
    revision: row.idempotency_key.slice(row.idempotency_key.lastIndexOf("#") + 1),
    statedAt: row.stated_at,
    container: row.container,
    indexed: row.indexed && (row.keyworded || !bm25Configured()),
  };
}

/** The hash of each text the collection holds now. */
export async function heldTexts(sql: Sql, collection: Collection): Promise<Set<string>> {
  const rows = await sql<{ hash: string }[]>`
    -- fence-ok: the hashes of the loader's own records in one collection, to tell a moved item from a new one
    select distinct r.content_hash as hash
      from event_log e join source_revision r on r.event_id = e.id
     where e.org_id = ${collection.orgId} and e.connector = ${ITEM_FEED} and e.workspace = ${collection.name}
       and e.record_key is not null`;
  return new Set(rows.map((r) => r.hash));
}

/** How many items the collection holds. */
export async function heldCount(sql: Sql, collection: Collection): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    -- fence-ok: a count of the loader's own records in one collection, for the removal limit
    select count(distinct record_key)::int as n
      from event_log
     where org_id = ${collection.orgId} and connector = ${ITEM_FEED} and workspace = ${collection.name}
       and record_key is not null`;
  return row?.n ?? 0;
}

/** The items the collection holds that `listed` does not name, a page at a time, with their words' hash. */
export async function* heldExcept(
  sql: Sql,
  collection: Collection,
  listed: ReadonlySet<string>,
): AsyncGenerator<{ key: string; events: HeldEvent[]; textHash: string | null }> {
  for (let after = ""; ; ) {
    const page = await sql<{ record_key: string; ids: string[]; hash: string | null }[]>`
      -- fence-ok: the loader's own records in one collection, paged by key, to find what a whole listing left out
      select e.record_key, array_agg(e.id order by e.id) as ids,
             (array_agg(r.content_hash order by upper(left(e.id, 10)) desc, e.id desc))[1] as hash
        from event_log e left join source_revision r on r.event_id = e.id
       where e.org_id = ${collection.orgId} and e.connector = ${ITEM_FEED} and e.workspace = ${collection.name}
         and e.record_key is not null and e.record_key > ${after}
       group by e.record_key order by e.record_key limit 500`;
    for (const r of page) {
      const key = keyOfRecordKey(r.record_key);
      if (listed.has(key)) continue;
      yield {
        key,
        events: r.ids.map((id) => eventOf(collection, id, r.record_key)),
        textHash: r.hash,
      };
    }
    const last = page.at(-1);
    if (!last || page.length < 500) return;
    after = last.record_key;
  }
}
