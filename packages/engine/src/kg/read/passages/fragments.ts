/**
 * The parts the passage reads repeat, each a fragment built on the caller's own handle, so a read inside a bounded
 * transaction stays inside it.
 */
import type { Queryable } from "../../core/sql.js";

/** The columns of a passage row (`Row`), on the alias `p`. */
export const passageColumns = (q: Queryable) =>
  q`p.id::text as id, p.event_id, p.seq, p.text, p.container, p.author, p.occurred_at`;
