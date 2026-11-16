import { indexRevisions } from "./index-record.js";
import { inOneTransaction, type Writes, writeHooksOf } from "./writes.js";

/**
 * The engine's indexer: accepted records made findable by `indexRevisions`, a batch at a time (their passages with their
 * header contexts, then their keyword entries in one durable write). The loader calls it after `acceptOpen`; a keyword entry or context the embedding service
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

/** Index the records, in order, and say for each what was written. One record is a batch of one. */
export async function indexOpen(
  writes: Writes,
  orgId: string,
  eventIds: readonly string[],
): Promise<OpenIndexResult[]> {
  const { sql } = writes;
  // The org first: `indexRevisions` reads by id, and a record of another org is not this caller's to index.
  const held = await sql<{ id: string }[]>`
    select id from event_log where id = any(${[...eventIds]}::text[]) and org_id = ${orgId}::uuid`;
  if (held.length !== new Set(eventIds).size) throw new OpenIndexMissing();
  const written = await indexRevisions(writes, eventIds);
  return inOneTransaction(writes, async (batch) => {
    const out: OpenIndexResult[] = [];
    for (const [i, eventId] of eventIds.entries())
      out.push(await settled(batch, orgId, { eventId, passages: written[i] ?? 0 }));
    return out;
  });
}

/** One record's outcome, once its batch is indexed: its status recorded, its keyword entry's state read. */
async function settled(
  writes: Writes,
  orgId: string,
  { eventId, passages }: { eventId: string; passages: number },
): Promise<OpenIndexResult> {
  const { sql } = writes;
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
