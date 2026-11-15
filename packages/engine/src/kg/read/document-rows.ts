import type { PendingQuery, Row } from "postgres";
import type { ReadingExpression } from "../../reading-effective.js";
import type { Queryable } from "../core/sql.js";
import { firstPassages } from "./documents/first-passages.sql.js";
import type { KnownPrecision } from "./precision.js";

/** One record's first passage, as a page row: what the reader and the document ranking read of it. */
export type FirstChunkRow = {
  id: string;
  tier: "passage";
  text: string;
  container: string;
  author: string | null;
  relayed: boolean;
  generated?: true;
  reading?: "reference";
  occurredAt: string;
  /** How much of `occurredAt` the source knew; absent is the whole instant. */
  occurredPrecision?: KnownPrecision;
  eventId: string;
  /** Its place in the record, when the row is a document's best-matching passage rather than its first. */
  seq?: number;
};

/**
 * One passage row per document, fenced again. A retriever that ranks whole documents hands back event ids; each is
 * represented by its first readable chunk, read under the caller's org, containers and as-of. The seam is trusted to
 * self-fence and re-fenced here anyway. With `best` (the build's keyword index's order, `keyword-index.ts`) it is the
 * document's best-matching readable passage instead, its first on a tie or none, so a document found by words in its fifth passage reaches the reranker as that
 * passage. A document with no readable passage is absent. Whether each is reference is the build's `reading`'s.
 */
export async function firstChunkRows(
  sql: Queryable,
  reading: ReadingExpression,
  args: {
    orgId: string;
    eventIds: string[];
    containers: string[];
    asOf?: string;
    best?: PendingQuery<Row[]> | null;
    /** Only a passage that states a figure. */
    digits?: boolean;
  },
): Promise<Map<string, FirstChunkRow>> {
  if (args.eventIds.length === 0) return new Map();
  const rows = await firstPassages(sql, reading, args);
  return new Map(
    rows.map((r) => [
      r.event_id,
      {
        id: r.id,
        tier: "passage" as const,
        text: r.text,
        container: r.container,
        author: r.author,
        relayed: r.relayed || r.generated,
        ...(r.generated ? { generated: true } : {}),
        ...(r.reference ? { reading: "reference" as const } : {}),
        occurredAt: r.occurred_at.toISOString(),
        ...(r.occurred_precision === null ? {} : { occurredPrecision: r.occurred_precision }),
        eventId: r.event_id,
        ...(args.best ? { seq: r.seq } : {}),
      },
    ]),
  );
}
