/**
 * Which of some passages were read off an image, from which page and by which reading — or are a linked page's preview
 * (`link`), by the link's position. A lookup by id over passages
 * a fenced read already admitted, so it narrows nothing and grants nothing.
 */
import type { Queryable } from "../../store/sql.js";

/** The image-read passages of `passageIds`, each with its page. */
export const readOffRows = (sql: Queryable, orgId: string, passageIds: readonly string[]) => sql<
  { id: string; page: number; reading: string; marker: string | null }[]
>`
      select id::text, page, reading, instruction_marker as marker from passage
       where org_id = ${orgId} and id = any(${[...passageIds]}::uuid[]) and reading in ('ocr', 'vision', 'link')
         and page is not null`;
