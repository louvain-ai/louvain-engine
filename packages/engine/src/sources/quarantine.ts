import { quarantineRecall } from "../ingest/quarantine.js";
import type { Queryable } from "../kg/core/sql.js";

/**
 * A quarantined record is not a source: its text carries instructions addressed to a model, so every sources reader
 * that fences a revision's event adds this, and every listing and read by id agrees with the record reader. It only
 * narrows what a reader is shown, and a quarantined record never hides a readable one. Written with the handle of the
 * read it serves.
 */
export function notQuarantined(sql: Queryable, event: string) {
  // Kept in recall by default (`ingest/quarantine.ts`): a held record is a source, labelled `instructionLike`
  // wherever it is read. With `LOUVAIN_QUARANTINE_RECALL=off` it is not a source at all, as above.
  if (quarantineRecall()) return sql`true`;
  return sql`${sql(event)}.outcome is distinct from 'quarantined'`;
}
