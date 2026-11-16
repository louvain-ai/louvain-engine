import { FILE_TYPE_RULES } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import type { ContainerSetShape } from "../fenced.js";
import { filterApp, namedConnection } from "./apps.js";
import { arrived, markedBy } from "./filter-asks.js";
import type { AddedFilters } from "./filter-seam.js";
import type { Listing, SearchInput } from "./input.js";
import { documentFence } from "./join.js";
/**
 * `and` one row per group among the rows this query returns, by the build's predicate (`AddedFilters.leadsItsSeries`),
 * over `lead_row`; nothing where the build has none.
 */
export function andLeadsItsSeries({ sql, s, added, input }: Listing, withApp: boolean) {
  const leads = added.leadsItsSeries;
  return leads ? sql`and (${leads(s, input, withApp)})` : sql``;
}

/** `and` one document of each group of copies, by the build's predicate; nothing where the build has none. */
function andLeadsItsCopies({ sql, s, added }: Listing, shape: ContainerSetShape | undefined) {
  const leads = added.leadsItsCopies;
  return leads ? sql`and (${leads(s.orgId, s.containers, shape)})` : sql``;
}
/**
 * What type of file a revision is (`type:`), in the one order a client's icons follow too: a media type that
 * names one type decides, then the last extension when the media type is generic or absent, then the reader's
 * format; a page, as the build declares one (`AddedFilters.page`), when none of those decided. One `case`, so a row is
 * one type.
 */
const GENERIC_MIMES = [
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/unknown",
  "application/x-download",
  "application/force-download",
  "text/plain",
];
const TYPE_ORDER = Object.keys(FILE_TYPE_RULES) as (keyof typeof FILE_TYPE_RULES)[];
function typeOf(sql: Queryable, page: AddedFilters["page"]) {
  const mime = sql`lower(split_part(coalesce(r.presentation #>> '{document,mimeType}', ''), ';', 1))`;
  const ext = sql`lower(substring(coalesce(r.presentation #>> '{document,filename}', '') from '\.([A-Za-z0-9]+)$'))`;
  const format = sql`lower(coalesce(r.presentation #>> '{document,format}', ''))`;
  const branches = [
    ...TYPE_ORDER.map(
      (t) => sql`when ${mime} = any(${[...FILE_TYPE_RULES[t].mimes]}::text[]) then ${t}`,
    ),
    ...TYPE_ORDER.map(
      (t) =>
        sql`when ${mime} = any(${GENERIC_MIMES}::text[]) and ${ext} = any(${[...FILE_TYPE_RULES[t].extensions]}::text[]) then ${t}`,
    ),
    ...TYPE_ORDER.map(
      (t) => sql`when ${format} = any(${[...FILE_TYPE_RULES[t].formats]}::text[]) then ${t}`,
    ),
  ];
  const pages = page ? sql`when ${page} then 'page'` : sql``;
  return sql`(case ${branches.reduce((a, b) => sql`${a} ${b}`)} ${pages} end)`;
}

/**
 * The fence, the filters (the build's among them, `added`, a second matcher's words with them) and one copy per
 * original. `shapes` writes the readable set as `any`
 * (estimated, so each test costs planning time) or `unnest` (planned blind), which only a test over few rows already
 * bounded by something else may take.
 */
export function listingFilter(
  listing: Listing,
  shapes: { fence?: ContainerSetShape; copies?: ContainerSetShape } = {},
) {
  const { sql, s, added, input } = listing;
  return sql`${documentFence(sql, s, shapes.fence)} ${andLeadsItsCopies(listing, shapes.copies)}
    ${s.reach ? sql`and d.id = any(${s.reach as string[]}::text[])` : sql``}
    ${added.words ? sql`and ${added.words.matches(s, input.q)}` : sql``}
    and (${input.kind ?? ""} = '' or r.kind = ${input.kind ?? ""})
    and (${input.author ?? ""} = '' or position(lower(${input.author ?? ""}) in lower(coalesce(r.author, ''))) > 0)
    ${input.type ? sql`and ${typeOf(sql, added.page)} = ${input.type}` : sql``}
    ${input.starredBy ? sql`and (${markedBy(added, s, input.starredBy)})` : sql``}
    ${input.narrow ? sql`and (${added.narrowed(sql, s, input.narrow)})` : sql``}
    ${input.news ? sql`and (${arrived(added, sql, { alias: "e", revision: "r" })})` : sql``}
    and ${dateWindow(sql, input)}`;
}
/**
 * `after`/`before` on the DOCUMENT's date, as whole days in the reader's time zone: the listing's window, and the
 * semantic leg's when one is set, so the two cannot disagree about what is in the range.
 */
export function dateWindow(sql: Queryable, input: SearchInput) {
  // An instant is exact: `after` from it, `before` through it, so a rolling window Search is
  // opened on holds what that window counted. A day stays a whole day in the reader's zone.
  const instant = (bound: string | undefined) => !!bound?.includes("T");
  const from = instant(input.after)
    ? sql`d.current_modified_at >= ${input.after as string}::timestamptz`
    : sql`(${input.after ?? null}::date is null or d.current_modified_at >= (${input.after ?? null}::date::timestamp at time zone ${input.timeZone ?? "UTC"}))`;
  const through = instant(input.before)
    ? sql`d.current_modified_at <= ${input.before as string}::timestamptz`
    : sql`(${input.before ?? null}::date is null or d.current_modified_at < ((${input.before ?? null}::date + 1)::timestamp at time zone ${input.timeZone ?? "UTC"}))`;
  return sql`${from} and ${through}`;
}
export const appFilter = ({ sql, s, added, input }: Listing) =>
  sql`(${input.app ?? ""} = '' or ${filterApp(sql, added.app)} = ${input.app ?? ""})
    and (${input.connection ?? ""} = '' or ${namedConnection(sql, s, "ce")} = ${input.connection ?? ""})`;
