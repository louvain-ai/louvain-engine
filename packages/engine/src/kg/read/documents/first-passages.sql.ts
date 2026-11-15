/**
 * One passage row per document, fenced again: a retriever that ranks whole documents hands back record ids, and each
 * is represented by its first readable passage, or with `best` by the passage the build's keyword index puts first (its
 * first on a tie or none). The seam is trusted to fence itself and is fenced here anyway: the boundary is the seam's.
 */
import { GENERATED_VIAS } from "@louvain/engine-core";
import type { PendingQuery, Row } from "postgres";
import type { ReadingExpression } from "../../../reading-effective.js";
import type { Queryable } from "../../core/sql.js";
import type { KnownPrecision } from "../precision.js";

type FirstPassagesRead = {
  orgId: string;
  eventIds: string[];
  containers: string[];
  asOf?: string;
  /** An order over `passage` that puts each document's best-matching passage first (`keyword-index.ts` `best`). */
  best?: PendingQuery<Row[]> | null;
  /** Only a passage that states a figure (a digit), as a figures read asks the passage legs (`passageFilter`). */
  digits?: boolean;
};

type FirstPassageRow = {
  id: string;
  event_id: string;
  text: string;
  container: string;
  author: string | null;
  relayed: boolean;
  occurred_at: Date;
  occurred_precision: KnownPrecision | null;
  generated: boolean;
  reference: boolean;
  seq: number;
};

/**
 * Each readable record of `eventIds` with one passage, its precision and whether it was generated or is reference (by
 * the build's `reading`).
 */
export const firstPassages = (
  sql: Queryable,
  reading: ReadingExpression,
  args: FirstPassagesRead,
) => sql<FirstPassageRow[]>`
    select distinct on (event_id) id::text, event_id, seq, text, container, author, relayed, occurred_at,
      (select g.occurred_precision from event_log g
        where g.org_id = passage.org_id and g.id = passage.event_id) as occurred_precision,
      -- A document an agent wrote, read whole, keeps the mark its passages carry.
      exists (select 1 from event_log g where g.org_id = passage.org_id and g.id = passage.event_id
            and g.body #>> '{presentation,document,via}' = any(${[...GENERATED_VIAS]}::text[])) as generated,
      -- Read as reference by the build's one reading, which referenceRead asks too.
      exists (select 1 from event_log g
              where g.org_id = passage.org_id and g.id = passage.event_id
                and coalesce(${reading(sql, "g")}, 'reference') <> 'knowledge') as reference
      from passage
     where org_id = ${args.orgId} and event_id = any(${args.eventIds}::text[])
       and container = any(${args.containers})
      ${saidBy(sql, args.asOf)}
      ${args.digits ? sql`and text ~ '[0-9]'` /* sql-shape: over the given records' passages only */ : sql``}
     order by event_id,
      ${args.best ?? sql``}
      seq`;

const saidBy = (sql: Queryable, asOf: string | undefined) =>
  asOf ? sql`and occurred_at <= ${asOf}` : sql``;
