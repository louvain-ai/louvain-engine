/**
 * These passages, if this reader may read them: org and collection in the where clause, so a passage in a collection
 * the reader has since lost is absent, never a null row saying an id exists.
 */
import type { Queryable } from "../../store/sql.js";
import type { Reader } from "../fence.js";
import { fenced } from "../fenced.js";
import { passageColumns } from "./fragments.js";
import type { Row } from "./leg-types.js";

/** The readable passages of `ids`, in no order. */
export const passagesWithIds = (q: Queryable, fence: Reader, ids: readonly string[]) => q<Row[]>`
      select ${passageColumns(q)}
        from passage p
       where p.org_id = ${fence.orgId} and ${fenced(q, fence, { column: q`p.container`, record: q`p.event_id` })}
         and p.id = any(${[...ids]}::uuid[])`;
