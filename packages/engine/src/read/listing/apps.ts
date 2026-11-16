import { singleAppByConnector } from "../../store/apps.js";
import type { Queryable } from "../../store/sql.js";
import { fenced } from "../fenced.js";
import type { Scope } from "./core.js";
import type { ShownApp } from "./filter-seam.js";

/**
 * The app a source shows as, by the build's expression (`AddedFilters.app`, handed by the read); else the service its
 * presentation names, else the ONE app its connector declares, else the connector itself. Read
 * at query time, so a connector's variant is filed under its app in a listing and an app filter, stored records too.
 */
const ownApp = (sql: Queryable) => sql`coalesce(r.presentation->>'service',
  coalesce(${sql.json(singleAppByConnector())}::jsonb ->> d.connector, d.connector))`;

export const displayApp = (sql: Queryable, app: ShownApp | null) => app?.shown() ?? ownApp(sql);

/** The app as a filter or a facet reads it: the build's expression's, else the one a row shows. */
export const filterApp = (sql: Queryable, app: ShownApp | null) =>
  app?.filtered() ?? displayApp(sql, app);

/**
 * The connection a source came through, as this viewer may name it: an id a client names a source by, and a facet
 * groups by. A container filed under another (`container_parent`) may be read without its parent, and its reader must
 * not learn the parent through the connection: where this viewer does NOT read the parent, there is no connection to
 * name (null, grouped with none). A reader of the parent sees the connection.
 */
export function namedConnection(sql: Queryable, s: Scope, event: string) {
  const x = sql(event);
  return sql`case when exists (
      select 1 from container_parent cp
      where cp.org_id = ${x}.org_id and cp.child = ${x}.container and not (${fenced(sql, s, { column: sql`cp.parent`, shape: "any" })})
    ) then null else ${x}.connection_id::text end`;
}
