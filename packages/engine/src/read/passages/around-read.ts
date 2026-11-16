/**
 * What a read of a hit's neighbours takes, and the rule every neighbour is held to: a message is not shown beside a
 * hit when a newer version of the same record has been read into passages the viewer reads, by the as-of, and no
 * version of the hit itself is its own neighbour. The newer-version half is the hit's own rule (`newerVersionRead`),
 * so a neighbour and a hit are retired alike.
 */

import type { Queryable } from "../../store/sql.js";
import { instantOf } from "../context.js";
import type { Reader } from "../fence.js";
import type { AddedFilters } from "../listing/filter-seam.js";
import { newerVersionRead } from "./filter.js";
import type { PassageFilters } from "./types.js";

export type AroundRead = { fence: Reader; filters: PassageFilters; added: AddedFilters };

/** A hit a walk starts from: its record, collection and instant (as text, so no microsecond is lost). */
export type Anchor = {
  event_id: string;
  container: string;
  at: string;
  connector: string;
  workspace: string;
  record_key: string | null;
  presentation: Record<string, unknown> | null;
  kind: string | null;
};

/** `p`, the neighbour's passage, is neither retired by a newer version nor a version of the hit. */
export function notSuperseded(
  q: Queryable,
  { fence, filters, added }: AroundRead,
  hit: { connector: string; workspace: string; record_key: string | null },
) {
  const asOf = filters.asOf;
  const { validAt, knownAt } = instantOf(asOf, "passages.around");
  return q`not exists (
      select 1 from event_log e
       where e.id = p.event_id and e.org_id = ${fence.orgId} and e.record_key is not null
         and (
           (e.connector = ${hit.connector} and e.workspace = ${hit.workspace}
             and e.record_key = ${hit.record_key ?? ""})
           or ${newerVersionRead(q, fence, { validAt, knownAt, whole: added.wholeKeys })}))`;
}
