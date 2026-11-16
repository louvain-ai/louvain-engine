/**
 * The hits a neighbour read starts from: each hit's first readable passage under the search's own fence and filters,
 * with what its record says of itself, so only a hit that is a chat message is walked.
 */
import type { Queryable } from "../../store/sql.js";
import type { Anchor, AroundRead } from "./around-read.js";
import { passageFilter } from "./filter.js";

/** The readable hits of `ids`, each with its record's feed, key, presentation and kind. */
export const hitAnchors = (q: Queryable, r: AroundRead, ids: string[]) => q<Anchor[]>`
          select p.event_id, p.container, p.occurred_at::text as at, e.connector, e.workspace, e.record_key,
                 e.body->'presentation' as presentation,
                 (select s.kind from source_revision s where s.event_id = p.event_id limit 1) as kind
            from passage p join event_log e on e.id = p.event_id and e.org_id = p.org_id
           where ${passageFilter(q, r.fence, { ...r.filters, recordIds: ids }, r.added)} and p.seq = 0`;
