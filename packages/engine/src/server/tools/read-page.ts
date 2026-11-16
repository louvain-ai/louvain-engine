import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import { resolveSource } from "../../read/listing/resolve.js";
import { records } from "../../read/records/index.js";
import { instructionLikeField } from "../../store/quarantine.js";
import { connectionOf } from "./arguments.js";
import { datedAs } from "./dated.js";
import type { LinkTo } from "./presentation.js";
import { authorOf } from "./search-hits.js";
import { textPage } from "./text-page.js";

/** No date ceiling: the last instant both a Date and Postgres write in ISO form. */
const UNDATED = "9999-12-31T23:59:59.999Z";

/** What the fenced read returned for an admitted record. */
export type ReadRevision = NonNullable<Awaited<ReturnType<typeof records.read>>>;

/**
 * What a host may add to a read, at its own place on the page: a copy to edit (`editCopy`) and the file's own bytes
 * (`original`), each asked only after the fenced read admitted the record. The engine's own server adds neither.
 */
export type ReadExtras<O extends object> = {
  editCopy?: (read: ReadRevision) => Promise<{ editCopy?: { url: string; label: string } }>;
  original?: (read: ReadRevision) => Promise<O | null>;
};

const NOT_VISIBLE = { error: "No source with that id is visible to you." } as const;

/**
 * `louvain_read_source`'s page: one source by any id this server hands out, its text paged, and what belongs with it.
 * The id is a model's choice after reading untrusted text, so `resolveSource` is the one door: the named version and
 * today's original must both be readable, and a version is admitted only of that same document; `records.read`
 * re-states the fence in SQL. Not found and not permitted are one answer: which it was is somebody else's fact.
 */
export async function readSourcePage<O extends object = never>(
  context: ReadContext,
  owner: Viewer,
  args: { id: string; version?: string | undefined; offset?: unknown },
  extras: ReadExtras<O> = {},
) {
  const scope = { orgId: owner.orgId, principal: owner.principal };
  const resolved = await resolveSource(context, scope, { id: args.id, version: args.version });
  if (!resolved) return NOT_VISIBLE;
  // Whatever a search listed opens, whatever its date: the fence admitted this id, so the date ceiling is lifted.
  const read = await records.read(context, scope, { id: resolved.recordId, at: UNDATED });
  if (!read) return NOT_VISIBLE;
  const readNames = read.summary?.connectionId
    ? await hooksOf(context).presentation.connectionNames(owner.orgId, owner.principal, [
        read.summary.connectionId,
      ])
    : new Map<string, string>();
  const original = extras.original ? await extras.original(read) : null;
  // The bytes are in the reply: the text the engine read is left out. A link alone keeps the text beside it.
  const held = original !== null && ("content" in original || "contentBase64" in original);
  return {
    ...described(read, readNames, resolved.documentId, hooksOf(context).presentation.linkTo),
    ...(extras.editCopy ? await extras.editCopy(read) : {}),
    ...instructionLikeField(read.instructionLike),
    ...(original ? { original } : {}),
    // With the original in hand the text the engine read is left out: the same words twice is twice the tokens.
    ...(held ? {} : { ...textPage(read.text, args.offset), textTruncated: read.ingestTruncated }),
    /**
     * What else belongs with it: the other messages of its thread and the other versions and copies of its document,
     * dated, fenced exactly as this read is (`records.related`). Ids are read_source ids.
     */
    related: await records.related(context, scope, read.recordId),
  };
}

/** What the list view says of a read record: its title, app, kind, author, date, address and whether it is current. */
function described(
  read: ReadRevision,
  names: ReadonlyMap<string, string>,
  documentId: string,
  linkTo: LinkTo,
) {
  return {
    id: read.recordId,
    title: read.summary?.title ?? null,
    app: read.summary?.app ?? read.connector,
    ...connectionOf(read.summary?.connectionId, names),
    kind: read.summary?.kind ?? read.recordKind,
    ...(read.summary ? authorOf(read.summary) : { author: read.speaker.author }),
    ...datedAs(
      "modifiedAt",
      read.summary?.sourceUpdatedAt ?? read.occurredAt,
      read.occurredPrecision,
    ),
    url: read.summary?.url ?? null,
    ...linkTo(documentId, {
      version: read.isCurrent ? null : read.recordId,
    }),
    isCurrentVersion: read.isCurrent,
  };
}
