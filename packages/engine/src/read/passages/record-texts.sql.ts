/**
 * The whole text of some records, fenced again, for locating each hit's passage in its record.
 */
import type { Queryable } from "../../store/sql.js";
import type { Reader } from "../fence.js";
import { fenced } from "../fenced.js";

/** Each readable record of `ids` with its text. */
export const revisionTextRows = (sql: Queryable, fence: Reader, ids: string[]) => sql<
  { id: string; text: string | null }[]
>`
    select id, body->>'text' as text from event_log
     where org_id = ${fence.orgId} and id = any(${ids}::text[])
       and ${fenced(sql, fence, { column: sql`container`, record: sql`id` })}`;
