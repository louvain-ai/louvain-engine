import type { PendingQuery, Row, Sql } from "postgres";
import { telemetryOf } from "../host/given.js";
import { declaringVersions, newerVersionHeld, newerVersions } from "../read/passages/versions.js";
import type { Queryable } from "../store/sql.js";
import { contextVectorNull } from "./passage-rules.js";
import { type Writes, writeHooksOf } from "./writes.js";

/**
 * A superseded version keeps its passages and loses their vectors. A whole-record change is restated as a new version
 * on every update and never withdrawn, so its older versions' vectors would stay indexed for nobody. One predicate
 * (`superseded`) decides: the reader's version rule with "a collection the reader reads" replaced by the old version's
 * own collection, so every reader of that collection reads the newer version. The fence is untouched, the row, its text
 * and its lexical vectors stay, and a dropped passage that is current for some read is reported as degraded by the
 * vector leg's probe. A withdrawal marks the other versions' dropped passages for recheck.
 */

/** The batch every statement here works in: bounded, so a large tenant is many short statements, never one long one. */
export const SUPERSEDED_BATCH = 500;

/** The old version's own container: the writer's `here` for the version rule (`newerVersionHeld`). */
const sameContainer =
  (q: Queryable, e: PendingQuery<Row[]>) =>
  (column: PendingQuery<Row[]>): PendingQuery<Row[]> =>
    q`${column} = ${e}.container`;

/**
 * The one rule, as a predicate on a passage `p` and its version `e`: the READER'S version rule (`newerVersionHeld`,
 * `read/passages/filter.ts`, the same fragment `newerVersionRead` asks) with "a container the viewer reads" replaced
 * by "the old version's own container", as of now, for a whole-record `record.change` passage in that container.
 */
export function superseded(q: Queryable, whole: readonly string[], e = q`e`): PendingQuery<Row[]> {
  return q`(${e}.kind = 'record.change' and ${e}.record_key is not null and ${e}.connection_id is not null
    and p.container = ${e}.container
    and ${newerVersionHeld(q, { here: sameContainer(q, e), at: { validAt: q`now()`, knownAt: null, whole }, e })})`;
}

/**
 * The witness, for the read probe's pre-filter: the earliest-stated newer version that retires `e` (`valid_from`), and
 * the first instant a read's `knownAt` sees both it and a version declaring the record whole (`known_from`). A read at
 * or after both is retired through that witness for every reader of the container; one before either may not be, and
 * the probe then asks the reader's own rule (`read/passages/vector.ts`). The witness's removal marks the passage
 * for recheck (`markForRecheck`).
 */
export const witness = (q: Queryable, whole: readonly string[]) => q`
  select w.occurred_at as valid_from, greatest(w.observed_at, d.known) as known_from
    from (${newerVersions(q, { here: sameContainer(q, q`e`), at: { validAt: q`now()`, knownAt: null, whole }, columns: q`r2.occurred_at, r2.observed_at, r2.id` })}
          order by r2.occurred_at, r2.id limit 1) w
   cross join (select min(m.observed_at) as known
                 from (${declaringVersions(q, { here: sameContainer(q, q`e`), at: { knownAt: null, whole }, columns: q`m.observed_at` })}) m) d`;

/**
 * Null the vectors of up to `limit` superseded passages: of one record's versions (`record`, the writer's case) or of
 * the org's flagged versions from `after` on (the script's id-batched pass). Returns the passages dropped and, for a
 * batched pass, the last event id it reached. A dry run (`apply: false`) counts instead and writes nothing.
 */
export async function dropSupersededVectors(
  writes: Writes,
  orgId: string,
  scope:
    | { record: { connector: string; workspace: string; recordKey: string } }
    | { after: string; events: number },
  opts: { apply?: boolean; limit?: number } = {},
): Promise<{ passages: number; lastEvent: string | null }> {
  const { sql } = writes;
  const limit = opts.limit ?? SUPERSEDED_BATCH;
  const versions = versionsIn(sql, orgId, scope);
  const last =
    "record" in scope
      ? null
      : ((await sql<{ id: string | null }[]>`select max(e.id) as id from (${versions}) e`)[0]?.id ??
        null);
  const candidates = sql`
    select p.id, f.valid_from, f.known_from
      from (${versions}) e
      join passage p on p.event_id = e.id and p.org_id = e.org_id
      cross join lateral (${witness(sql, writeHooksOf(writes).filters.wholeKeys)}) f
     where p.vector_dropped_at is null and ${superseded(sql, writeHooksOf(writes).filters.wholeKeys)}
     limit ${limit}`;
  if (opts.apply === false) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from (${candidates}) c`;
    return { passages: row?.n ?? 0, lastEvent: last };
  }
  const dropped = await sql<{ id: string }[]>`
    update passage p
       set embedding = null, ${contextVectorNull(writeHooksOf(writes).passageRules, sql)}
           vector_dropped_at = now(), superseded_valid_from = c.valid_from, superseded_known_from = c.known_from
      from (${candidates}) c
     where p.id = c.id and p.vector_dropped_at is null
    returning p.id::text as id`;
  if (dropped.length > 0) telemetryOf(writes).count("passage.vectors.dropped", dropped.length, {});
  return { passages: dropped.length, lastEvent: last };
}

/** The versions a drop looks at: one record's newer-than versions, or a batch of the org's flagged ones by id. */
function versionsIn(sql: Sql, orgId: string, scope: Parameters<typeof dropSupersededVectors>[2]) {
  return "record" in scope
    ? sql`select e.* from event_log e
             where e.org_id = ${orgId} and e.connector = ${scope.record.connector}
               and e.workspace = ${scope.record.workspace} and e.record_key = ${scope.record.recordKey}
               and e.kind = 'record.change' and e.has_newer`
    : sql`select e.* from event_log e
             where e.org_id = ${orgId} and e.id > ${scope.after} and e.kind = 'record.change'
               and e.record_key is not null and e.has_newer
             order by e.id limit ${scope.events}`;
}

/**
 * A record's superseded versions lose their vectors now: the moment this
 * version's passages exist is the moment an older version in the same container and connection stops being found by
 * anyone's vector leg, and a version written late (older than one already read) is dropped as it lands. Best-effort:
 * the passages are written whatever happens here, and a version left with its vectors is only what every version was
 * before; that script and the next write of the record catch it.
 */
export async function dropDocumentSupersededVectors(
  writes: Writes,
  orgId: string,
  eventId: string,
): Promise<void> {
  try {
    const [e] = await writes.sql<
      { connector: string; workspace: string; key: string | null; kind: string }[]
    >`
      select connector, workspace, record_key as key, kind from event_log
       where id = ${eventId} and org_id = ${orgId}`;
    if (!e?.key || e.kind !== "record.change") return;
    const record = { connector: e.connector, workspace: e.workspace, recordKey: e.key };
    let more = true;
    while (more)
      more = (await dropSupersededVectors(writes, orgId, { record })).passages >= SUPERSEDED_BATCH;
  } catch (err) {
    // swallowed: dropping superseded vectors saves space and never decides what anyone reads; a failure leaves the
    // older version embedded, as every version was before, and is counted.
    telemetryOf(writes).count("passage.vectors.drop_failed", 1, {});
    void err;
  }
}
