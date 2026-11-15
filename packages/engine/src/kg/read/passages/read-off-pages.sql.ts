/**
 * Which of some passages were read off an image, from which page and by which reading. A lookup by id over passages
 * a fenced read already admitted, so it narrows nothing and grants nothing.
 */
import type { Queryable } from "../../core/sql.js";

/** The image-read passages of `passageIds`, each with its page. */
export const readOffRows = (sql: Queryable, orgId: string, passageIds: readonly string[]) => sql<
  { id: string; page: number; reading: string }[]
>`
      select id::text, page, reading from passage
       where org_id = ${orgId} and id = any(${[...passageIds]}::uuid[]) and reading in ('ocr', 'vision')
         and page is not null`;
