import type { Viewer } from "@louvain/engine-core";
import { telemetryOf } from "../../host/given.js";
import type { Queryable } from "../../store/sql.js";
import { documentShape } from "../../text/record-shape.js";
import { bounded, fence, type ReadContext } from "../fence.js";
import { agentWritten, instructionLikeRevisions, labelOf } from "../generated.js";
import { hooksOf } from "../hooks.js";
import { isStatementTimeout } from "../legs.js";
import { stage } from "../question.js";
import { hitAnchors } from "./around-anchors.sql.js";
import { linkedBefore } from "./around-linked.sql.js";
import { type Near, walkFrom } from "./around-walk.sql.js";
import type { PassageFilters } from "./types.js";

/** A message beside a chat hit, in its own words, as `passagesAround` hands it back. */
export type Neighbour = {
  recordId: string;
  /** Messages away from the hit: negative before it, positive after. */
  offset: number;
  /** Who said it, as the caller's namer names them to this reader; without one, as written. */
  author: string | null;
  occurredAt: string;
  /** The record's first passage, clipped to `NEIGHBOUR_CHARS`. */
  text: string;
  generated?: true;
  instructionLike?: { marker: string };
  /**
   * An earlier message this one is linked to (`opts.ancestry`), not one beside it in time: `offset` then counts back
   * along the links (-1 the message it continues), never messages in the collection.
   */
  linked?: true;
};

/** One neighbour's words at most: a chat message rarely runs past it, and a long one is context, not the answer. */
const NEIGHBOUR_CHARS = 600;

/**
 * A chat hit's neighbours, read at query time: for each hit that is a chat message (`documentShape`), the `k` messages
 * either side of it in the same collection, by the time they were said (`walkFrom`), bounded by count. Every neighbour
 * passes the search's own fence, filters, as-of and version rule (`passageFilter`), and one collection has one set of
 * readers, so a neighbour never shows what the hit did not. Linked messages (`opts.ancestry`) fill what the window
 * leaves, under the same rule. At most `maxChars` across every hit: the best-ranked hit and nearest message first.
 */
export async function passagesAround(
  context: ReadContext,
  viewer: Viewer,
  recordIds: readonly string[],
  opts: {
    k: number;
    maxChars: number;
    filters?: PassageFilters;
    /** Per hit, the earlier messages it is linked back to, nearest first; read under the fence. */
    ancestry?: ReadonlyMap<string, readonly string[]>;
    /** Who each message's author is to this reader; none, every author as written. */
    names?: SpeakerNamer;
  },
): Promise<{ around: Map<string, Neighbour[]>; degraded: string[] }> {
  const around = new Map<string, Neighbour[]>();
  // The caller's `recordIds` names the hits, not the neighbours: a neighbour is by definition another record. Every
  // other filter (a sender, participants, a window) narrows the neighbours as it narrowed the search.
  const { recordIds: _ignored, ...filters } = opts.filters ?? {};
  const reader = await fence(context, viewer, filters.containers);
  const ids = [...new Set(recordIds)].slice(0, AROUND_MAX_HITS);
  const k = Math.min(Math.max(0, Math.floor(opts.k)), AROUND_MAX_K);
  if (!reader || ids.length === 0 || k === 0 || opts.maxChars <= 0) {
    return { around, degraded: [] };
  }
  // A hit admitted by id from outside the fence gets no neighbour there: only rows the fence itself admits are read.
  const read = { fence: reader, filters, added: hooksOf(context).filters };
  let near: Near[];
  try {
    near = await stage("ask.around", () =>
      bounded(context, async (q) => {
        const anchors = await hitAnchors(q, read, ids);
        const chats = chatAnchorsInRank(anchors, ids);
        const walks = await Promise.all(
          chats.flatMap((a) => [-1, 1].map((dir) => walkFrom(q, { ...read, k }, a, dir))),
        );
        const linked = await Promise.all(
          chats.map(async (a) => {
            const back = [...new Set(opts.ancestry?.get(a.event_id) ?? [])].slice(0, AROUND_MAX_K);
            if (back.length === 0) return [];
            const rows = await linkedBefore(q, read, a, back);
            // Nearest along the links first, as the caller listed them.
            return rows
              .map((r) => ({ ...r, rn: back.indexOf(r.event_id) + 1 }))
              .sort((x, y) => x.rn - y.rn);
          }),
        );
        return [...linked.flat(), ...walks.flat()];
      }),
    );
  } catch (err) {
    // A walk cut by its statement timeout costs the context beside hits the caller already has, never the page, and
    // says so; anything else is a fault and is thrown.
    if (!isStatementTimeout(err)) throw err;
    telemetryOf(context).count("kg.read.around.cut", 1, {});
    return { around, degraded: ["around:cut"] };
  }
  const neighbourIds = near.map((n) => n.event_id);
  // The caller's namer (`opts.names`) says who each author is to this reader; without one, authors read as written.
  const asSpeaker = (n: Near) => ({
    recordId: n.event_id,
    container: n.container,
    speaker: { entityId: null, label: null, author: n.author },
  });
  const [generated, instructionLike, named] = await Promise.all([
    agentWritten(context.sql, reader.orgId, neighbourIds),
    instructionLikeRevisions(context.sql, reader.orgId, neighbourIds),
    opts.names?.(context.sql, viewer, near.map(asSpeaker)) ?? new Map<string, NamedSpeaker>(),
  ]);
  // The budget, spent where the reader looks: the best-ranked hit first, and each hit's nearest messages first.
  let left = opts.maxChars;
  for (const id of ids) {
    // The window first, then the linked messages into what is left, so the links never spend the window's budget. A
    // message both linked and beside the hit is shown once, as linked.
    const all = near.filter((n) => n.anchor === id);
    const linkedIds = new Set(all.filter((n) => n.linked).map((n) => n.event_id));
    const byRank = (a: Near, b: Near) => a.rn - b.rn || a.dir - b.dir;
    const mine = [
      ...all.filter((n) => !n.linked && !linkedIds.has(n.event_id)).sort(byRank),
      ...all.filter((n) => n.linked).sort(byRank),
    ];
    const kept: Neighbour[] = [];
    for (const n of mine) {
      const text =
        n.text.length > NEIGHBOUR_CHARS ? `${n.text.slice(0, NEIGHBOUR_CHARS)}…` : n.text;
      if (text.length > left) break;
      left -= text.length;
      kept.push({
        recordId: n.event_id,
        offset: n.dir * n.rn,
        author: named.get(speakerKey(asSpeaker(n)))?.label ?? n.author,
        occurredAt: new Date(n.occurred_at).toISOString(),
        text,
        ...(generated.has(n.event_id) ? { generated: true as const } : {}),
        ...labelOf(instructionLike, n.event_id),
        ...(n.linked ? { linked: true as const } : {}),
      });
    }
    // Shown in reading order: the linked messages oldest first, then the window around the hit.
    if (kept.length > 0)
      around.set(id, [
        ...kept.filter((n) => n.linked).sort((a, b) => a.offset - b.offset),
        ...kept.filter((n) => !n.linked).sort((a, b) => a.offset - b.offset),
      ]);
    if (left <= 0) break;
  }
  return { around, degraded: [] };
}

/**
 * The hits that are chat messages, in the caller's rank order rather than the heap's: everything after them (the
 * neighbours, the ids handed to the label lookups) is then the same on every run.
 */
function chatAnchorsInRank<
  A extends {
    event_id: string;
    connector: string;
    presentation: Record<string, unknown> | null;
    kind: string | null;
  },
>(anchors: readonly A[], ids: readonly string[]): A[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return anchors
    .filter(
      (a) =>
        documentShape({
          presentation: a.presentation ?? {},
          connector: a.connector,
          kind: a.kind,
        }) === "chat",
    )
    .sort((x, y) => (rank.get(x.event_id) ?? 0) - (rank.get(y.event_id) ?? 0));
}

/** A message's speaker as a namer is handed it: the entity it was bound to, its label and the author as written. */
type Speaker = { entityId: string | null; label: string | null; author: string | null };
/** Who a speaker is to this reader. */
type NamedSpeaker = { entityId: string | null; label: string | null };

/** The key a namer's map is read by: one record's one author. */
export const speakerKey = (row: { recordId: string; speaker: Speaker | null }): string =>
  `${row.recordId}|${row.speaker?.author ?? ""}`;

/**
 * What names a conversation's speakers for a reader, keyed by `speakerKey`; the caller supplies it. Without one, every
 * author reads as written.
 */
export type SpeakerNamer = (
  q: Queryable,
  viewer: Viewer,
  rows: readonly { recordId: string; container: string; speaker: Speaker | null }[],
) => Promise<Map<string, NamedSpeaker>>;

/** At most this many hits are expanded in one call, and this many messages each way: context, not a second search. */
const AROUND_MAX_HITS = 10;
const AROUND_MAX_K = 10;
