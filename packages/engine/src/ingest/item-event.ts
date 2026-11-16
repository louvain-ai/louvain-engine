import { createHash } from "node:crypto";
import {
  firstMalformedTextPath,
  type IngestItem,
  type ItemKind,
  MALFORMED_TEXT_MESSAGE,
  MAX_ITEM_TEXT_CHARS,
} from "@louvain/engine-core";
import { ITEM_FEED, ITEM_RECORD_TYPE } from "./item-feed.js";
import type { Revision } from "./revision.js";
import { ulid } from "./ulid.js";

/** An item that carries content, as opposed to one that removes a key. */
export type ContentItem = Exclude<IngestItem, { removed: true }>;

const EVENT_KIND: Record<ItemKind, string> = {
  document: "file",
  message: "message",
  record: "record.change",
};

/**
 * How an item presents itself, so its key and title reach the keyword index as its header: a document by the name it
 * is known by, a record by its key field (rendered whole each time, so a newer version supersedes all of it).
 */
function presentation(item: ContentItem, kind: ItemKind): object {
  // The app it came from is what the record shows as, which is what search narrows by.
  const service = item.app ? { service: item.app } : {};
  if (kind === "message") return item.app ? { presentation: service } : {};
  if (kind === "record")
    return {
      presentation: {
        ...service,
        record: { fields: [{ label: "key", value: item.key }] },
        whole: true,
      },
    };
  const filename = item.title ? `${item.title} · ${item.key}` : item.key;
  return { presentation: { ...service, document: { filename } } };
}

/** The folder inside the collection an item sits in; `.` is the collection's top. */
export const containerOf = (item: ContentItem): string => item.container ?? ".";

/** The source's own revision, else a hash of everything the stored revision says, so any change is a new one. */
export function revisionOf(item: ContentItem, text: string): string {
  if (item.revision) return item.revision;
  const { key: _key, text: _text, file: _file, revision: _revision, ...said } = item;
  return createHash("sha256")
    .update(JSON.stringify([text, containerOf(item), Object.entries(said).sort()]))
    .digest("hex")
    .slice(0, 32);
}

/** The hash a stored revision keeps of its text: the same words under a new key is a move. */
export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** An item's revision: the one form the engine's accept takes, minted once so its id is the same wherever it goes. */
export function itemRevision(
  collection: string,
  item: ContentItem,
  version: { text: string; revision: string; at: Date },
): Revision {
  const kind = item.kind ?? "document";
  const when = item.date ?? version.at.toISOString();
  return {
    id: ulid(),
    idempotencyKey: `${item.key}#${version.revision}`,
    source: {
      connector: ITEM_FEED,
      workspace: collection,
      container: containerOf(item),
      nativeId: item.key,
      type: kind,
      ...(item.title ? { title: item.title } : {}),
      ...(item.url ? { ref: item.url } : {}),
      ...(item.author ? { authorName: item.author } : {}),
      ...(item.updated ? { updatedAt: item.updated } : {}),
    },
    record: { objectType: ITEM_RECORD_TYPE, nativeId: item.key },
    kind: EVENT_KIND[kind],
    occurredAt: when,
    // An undated item says so, so its time is never mistaken for one its source stated.
    ...(item.precision
      ? { occurredPrecision: item.precision }
      : item.date
        ? {}
        : { occurredPrecision: "unknown" }),
    observedAt: when,
    // With no author named, the actor is the placeholder a source uses for one it cannot tell, which no page shows.
    actor: { sourceUserId: item.author ?? "unknown" },
    body: { text: version.text, ...presentation(item, kind) },
    permissions: { visibility: "container" },
  };
}

/**
 * What the engine cannot store of an item's revision, where, or null: its text past the item's cap (a file read whole
 * can be longer than an item may send), or a string a database cannot hold (`well-formed.ts`).
 */
export function revisionProblem(revision: Revision): { at: string; why: string } | null {
  const text = (revision.body as { text: string }).text;
  if (text.length > MAX_ITEM_TEXT_CHARS)
    return {
      at: "body.text",
      why: `body.text may be at most ${MAX_ITEM_TEXT_CHARS} characters; send a longer document as several items`,
    };
  const path = firstMalformedTextPath(revision);
  return path ? { at: path.join("."), why: MALFORMED_TEXT_MESSAGE } : null;
}
