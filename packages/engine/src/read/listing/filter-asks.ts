import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../../store/sql.js";
import { type AddedFilters, FilterUnsupported } from "./filter-seam.js";

type Fragment = PendingQuery<Row[]>;
/** The reader a mark is read for: its org and the collections it reads. */
type Reader = { orgId: string; containers: string[] };

/** The build's predicate for what `principal` marked; refused where the build has none. */
export function markedBy(added: AddedFilters, s: Reader, principal: string): Fragment {
  const by = added.markedBy;
  if (by === null) throw new FilterUnsupported("`starredBy`");
  return by(s, principal);
}

/** The build's sender predicates for `principal`; refused where the build has none. */
export function sentBy(
  added: AddedFilters,
  sql: Queryable,
  reader: { orgId: string; principal: string },
) {
  const by = added.sentBy;
  if (by === null) throw new FilterUnsupported("`direction`");
  return by(sql, reader.orgId, reader.principal);
}

/** The build's arrivals predicate over the listing's `e` and `r`; refused where the build has none. */
export function arrived(
  added: AddedFilters,
  sql: Queryable,
  { alias, revision }: { alias: string; revision: string },
): Fragment {
  const counted = added.arrived;
  if (counted === null) throw new FilterUnsupported("`news`");
  return counted(sql, alias, revision);
}

/** The build's predicate for these genres; refused where the build has none. */
export function genreIn(
  added: AddedFilters,
  sql: Queryable,
  { orgId, genres }: { orgId: string; genres: string[] },
): Fragment {
  const labelled = added.genreIn;
  if (labelled === null) throw new FilterUnsupported("`genre`");
  return labelled(sql, orgId, genres);
}
