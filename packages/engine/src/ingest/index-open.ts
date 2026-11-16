import { type Writes, writeHooksOf } from "../writes.js";
import { indexRecord } from "./index-core.js";

/**
 * The engine's indexer: one accepted record made findable by `indexRecord` (its passages with their header contexts,
 * then its keyword entry). The loader calls it after `acceptOpen`; a keyword entry or context the embedding service
 * misses is counted and returned as `missed`, so a loader can report it and run again. Idempotent: a second run writes
 * nothing and answers the same.
 */
export type OpenIndexResult = {
  /** Passages this run wrote (0 on a re-run). */
  passages: number;
  /**
   * The keyword entry: written; no keyword index configured; missed (the sidecar failed, a re-run retries); or skipped,
   * a record with nothing to index (no text, past the cap, held, or not content), which a re-run will not change.
   */
  keyword: "indexed" | "unconfigured" | "missed" | "skipped";
};

export class OpenIndexMissing extends Error {
  constructor() {
    super("no accepted content record with that id in this org");
    this.name = "OpenIndexMissing";
  }
}

export async function indexOpen(
  writes: Writes,
  orgId: string,
  eventId: string,
): Promise<OpenIndexResult> {
  const { sql } = writes;
  // The org first: `indexRecord` reads by id, and a record of another org is not this caller's to index.
  const [held] = await sql<{ id: string }[]>`
    select id from event_log where id = ${eventId} and org_id = ${orgId}::uuid`;
  if (!held) throw new OpenIndexMissing();
  const passages = await indexRecord(writes, eventId);
  await sql`
    update event_log set index_status = 'done',
      indexed_at = clock_timestamp(), first_indexed_at = coalesce(first_indexed_at, clock_timestamp())
    where id = ${eventId} and org_id = ${orgId}::uuid`;
  const [row] = await sql<{ keyword_indexed_at: Date | null; passages: number }[]>`
    select keyword_indexed_at,
      (select count(*)::int from passage p where p.event_id = e.id and p.org_id = e.org_id) as passages
    from event_log e where id = ${eventId} and org_id = ${orgId}::uuid`;
  const keyword = !writeHooksOf(writes).keyword.endpoint.configured()
    ? "unconfigured"
    : row?.keyword_indexed_at
      ? "indexed"
      : (row?.passages ?? 0) === 0
        ? "skipped"
        : "missed";
  return { passages, keyword };
}
