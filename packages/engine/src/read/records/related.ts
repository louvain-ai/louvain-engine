/**
 * What else belongs with one record: the other messages of its thread (a mail connector sends one record per message)
 * and the other versions and copies of its document, dated, so a reader that finds two values can tell which is newer.
 * Fenced like the record itself: a sibling or version this viewer cannot read is never listed, not its id, title or
 * date. Bounded: `RELATED_MAX` of each.
 */

import type { Viewer } from "@louvain/engine-core";
import type { Queryable } from "../../store/sql.js";
import { bounded, fence, fenced, type ReadContext, type Reader } from "../fence.js";
import { notQuarantined } from "../listing/quarantine.js";
import { conversationKeySql } from "./conversation.js";

/** At most this many of each kind of related source are listed; past it, `more` says there are others. */
const RELATED_MAX = 20;

type RelatedSource = {
  /** The record id, which `records.read` takes. */
  id: string;
  title: string | null;
  /** When the source dated it: a message's sending, a document version's last change. */
  date: string;
};

export type RelatedRecords = {
  /** The other messages of this message's thread, oldest first. Empty for anything that is not a threaded message. */
  thread: RelatedSource[];
  /**
   * The other versions of this document, and its copies elsewhere (the same `origin_key`), newest first. `newest`
   * marks the one this viewer reads that changed last — this record itself when `selfNewest` is true.
   */
  versions: (RelatedSource & { sameDocument: boolean; newest: boolean })[];
  selfNewest: boolean;
  more: { thread: boolean; versions: boolean };
};

const NO_RELATED: RelatedRecords = {
  thread: [],
  versions: [],
  selfNewest: true,
  more: { thread: false, versions: false },
};

/** The thread and the versions and copies of one record, for this viewer. */
export async function relatedRecords(
  context: ReadContext,
  viewer: Viewer,
  recordId: string,
): Promise<RelatedRecords> {
  const { sql } = context;
  const reader = await fence(context, viewer);
  if (!reader) return NO_RELATED;
  const key = sql.unsafe(conversationKeySql("e.body"));
  const siblingKey = sql.unsafe(conversationKeySql("s.body"));
  const [thread, versions] = await bounded(context, (q) =>
    Promise.all([
      threadRows(q, { fence: reader, recordId, key, siblingKey }),
      versionRows(q, { fence: reader, recordId }),
    ]),
  );
  return relatedOf(recordId, thread, versions);
}

type Key = ReturnType<Queryable["unsafe"]>;

/** The other messages of the record's thread, by the source's own thread id inside the record's collection. */
function threadRows(
  q: Queryable,
  {
    fence,
    recordId,
    key,
    siblingKey,
  }: { fence: Reader; recordId: string; key: Key; siblingKey: Key },
) {
  return q<{ id: string; title: string | null; date: Date }[]>`
        select s.id, r.title, s.occurred_at as date
        from event_log e
        join event_log s on s.org_id = e.org_id and s.container = e.container and s.kind = 'message'
          and s.id <> e.id and ${siblingKey} = ${key}
        left join source_revision r on r.event_id = s.id
        where e.org_id = ${fence.orgId} and e.id = ${recordId} and e.kind = 'message' and ${key} is not null
          and ${fenced(q, fence, q`e.container`, { record: q`e.id` })} and ${notQuarantined(q, "e")}
          and ${fenced(q, fence, q`s.container`, { record: q`s.id` })} and ${notQuarantined(q, "s")}
        order by s.occurred_at, s.id
        limit ${RELATED_MAX + 1}`;
}

/** The record's document's versions and its copies elsewhere (the same origin key), newest first. */
function versionRows(q: Queryable, { fence, recordId }: { fence: Reader; recordId: string }) {
  return q<
    { id: string; title: string | null; date: Date; same_document: boolean; is_self: boolean }[]
  >`
        with own as (
          select d.id as document_id, d.origin_key
          from event_log e
          join source_revision r on r.event_id = e.id
          join source_document d on d.id = r.source_id and d.org_id = e.org_id
          where e.org_id = ${fence.orgId} and e.id = ${recordId}
            and ${fenced(q, fence, q`e.container`, { record: q`e.id` })} and ${notQuarantined(q, "e")}
        )
        select v.event_id as id, v.title, v.modified_at as date,
               v.source_id = own.document_id as same_document, v.event_id = ${recordId} as is_self
        from own
        join source_document d on d.org_id = ${fence.orgId}
          and (d.id = own.document_id or (own.origin_key is not null and d.origin_key = own.origin_key))
        join source_revision v on v.source_id = d.id
        join event_log ve on ve.id = v.event_id and ve.org_id = ${fence.orgId}
        where ${fenced(q, fence, q`ve.container`, { record: q`ve.id` })} and ${notQuarantined(q, "ve")}
        order by v.modified_at desc, v.event_id desc
        limit ${RELATED_MAX + 2}`;
}

/**
 * The page: the newest version this viewer reads is the first row, by the order the writer picks a document's current
 * version in (later `modified_at`, then later event id).
 */
function relatedOf(
  recordId: string,
  thread: { id: string; title: string | null; date: Date }[],
  versions: {
    id: string;
    title: string | null;
    date: Date;
    same_document: boolean;
    is_self: boolean;
  }[],
): RelatedRecords {
  const iso = (d: Date) => new Date(d).toISOString();
  const newestId = versions[0]?.id ?? recordId;
  const others = versions.filter((v) => !v.is_self);
  return {
    thread: thread
      .slice(0, RELATED_MAX)
      .map((r) => ({ id: r.id, title: r.title, date: iso(r.date) })),
    versions: others.slice(0, RELATED_MAX).map((v) => ({
      id: v.id,
      title: v.title,
      date: iso(v.date),
      sameDocument: v.same_document,
      newest: v.id === newestId,
    })),
    selfNewest: newestId === recordId,
    more: { thread: thread.length > RELATED_MAX, versions: others.length > RELATED_MAX },
  };
}
