import { createHash } from "node:crypto";
import type { PendingQuery, Row } from "postgres";
import { bounded, type ReadContext } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import {
  documentFence as fence,
  type Scope,
  type SourceRow,
  sourceJoin,
  summaryColumns,
} from "../../read/listing/core.js";
import type { Queryable } from "../../store/sql.js";
import type { Identifier } from "./identifier.js";

/**
 * The lookup's fenced statements. Each reads the reader's CURRENT documents through the listing's own `fence` (the
 * document, its current version and its container readable, not quarantined), so a document the reader cannot read is
 * never a candidate, a match or a count. The legs below only propose ids; the fenced statement decides.
 */

/** The most candidates read at once: past it, what the lookup says IS the identifier is a floor. */
export const CANDIDATES_READ = 200;

export type Candidate = SourceRow & { nativeId: string };

/** The reader's current documents among `ids`, newest first, at most `CANDIDATES_READ`. */
function fencedAmong(context: ReadContext, s: Scope, ids: PendingQuery<Row[]>) {
  return bounded(
    context,
    (q) => q<Candidate[]>`
      select ${summaryColumns(q, s, hooksOf(context).filters)}, d.native_id as "nativeId"
      ${sourceJoin(q)}
      where ${fence(q, s)} and r.event_id = d.current_event_id and d.id in (${ids})
      order by d.current_modified_at desc, d.id
      limit ${CANDIDATES_READ}`,
  );
}

/** A URL's digest as the URL index keys it: `md5(url)`, hex. */
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

/** The (connector, workspace) pairs of the reader's containers: the key a source's own id is unique under. */
function feedsOf(s: Scope): { connectors: string[]; workspaces: string[] } {
  const pairs = new Map<string, [string, string]>();
  for (const container of s.containers) {
    const [connector, workspace] = container.split("/");
    if (connector && workspace) pairs.set(`${connector}/${workspace}`, [connector, workspace]);
  }
  return {
    connectors: [...pairs.values()].map(([c]) => c),
    workspaces: [...pairs.values()].map(([, w]) => w),
  };
}

/** By its own id in its app, through `native_id`'s unique key (org, connector, workspace, native id). */
function byExternalId(sql: Queryable, s: Scope, i: Identifier) {
  const { connectors, workspaces } = feedsOf(s);
  return sql`select d.id from source_document d
    join unnest(${connectors}::text[], ${workspaces}::text[]) as feed(connector, workspace)
      on d.connector = feed.connector and d.workspace = feed.workspace
    where d.org_id = ${s.orgId} and d.native_id = ${i.text}`;
}

/** How much of a title its index keys on: 200 characters, lower-cased, well inside a btree entry. */
const TITLE_KEY_CHARS = 200;

/**
 * By the whole title, or a file name's stem as the whole title: an equality on the title's indexed key
 * (`source_revision_org_title_key_idx`), then on the whole title for the rows that key returns.
 */
function byWholeTitle(sql: Queryable, s: Scope, i: Identifier) {
  const titles = [i.text, ...(i.stem ? [i.stem] : [])];
  const keys = titles.map((t) => sql`lower(left(${t}, ${TITLE_KEY_CHARS}))`);
  return sql`select d.id from source_revision r join source_document d on d.current_event_id = r.event_id
    where r.org_id = ${s.orgId} and d.org_id = ${s.orgId}
      -- sql-shape: source_revision_org_title_key_idx's own expression, read as an index equality
      and lower(left(r.title, ${TITLE_KEY_CHARS})) = any(array[${keys.reduce((all, k) => sql`${all}, ${k}`)}])
      -- sql-shape: the whole title, re-checked on the rows that indexed key returned
      and lower(r.title) = any(array[${titles.map((t) => sql`lower(${t})`).reduce((all, k) => sql`${all}, ${k}`)}])`;
}

/**
 * By URL, exactly: an equality on the URL's indexed digest (`source_revision_org_url_key_idx`), then on the URL itself
 * for the rows that digest returns.
 */
function byUrl(sql: Queryable, s: Scope, i: Identifier) {
  return sql`select d.id from source_revision r join source_document d on d.current_event_id = r.event_id
    where r.org_id = ${s.orgId} and d.org_id = ${s.orgId}
      and r.url is not null and md5(r.url) = any(${i.urls.map(md5)}::text[])
      and r.url = any(${i.urls}::text[])`;
}

/** The candidates an identifier is looked up by: its document id, its own id, its title and title key, its URL. */
export async function exactCandidates(
  context: ReadContext,
  s: Scope,
  i: Identifier,
): Promise<Candidate[]> {
  const { sql } = context;
  // The candidates for a title that opens with a key: the build's (`exact-seam.ts`); `matchedOn` decides.
  const titleKey = await hooksOf(context).exact.titleKey(context, s, i);
  const legs = [
    ...(i.documentId ? [sql`select ${i.documentId}::text as id`] : []),
    byExternalId(sql, s, i),
    ...(titleKey ? [titleKey.leg] : []),
    byWholeTitle(sql, s, i),
    ...(i.urls.length > 0 ? [byUrl(sql, s, i)] : []),
  ].reduce((all, leg) => sql`${all} union ${leg}`);
  const rows = await fencedAmong(context, s, legs);
  return rows.map((row) => ({ ...row, titleKey: titleKey?.keyed(row) ?? false }));
}
