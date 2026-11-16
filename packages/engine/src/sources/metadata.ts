import { createHash } from "node:crypto";
import { safeSourceUrl } from "@louvain/engine-core";
import type { JSONValue } from "postgres";
import type { Revision } from "../ingest/revision.js";

/**
 * How a source's presentation is read, which the build supplies: what a source shows is the build's to say, and a
 * presentation its reader refuses is stored as none. A zod schema's `safeParse` is one.
 */
type ReadPresentation<P extends Presented> = (
  raw: unknown,
) => { success: true; data: P } | { success: false };

/** A presentation as its reader made it: stored and returned, never read into here. */
export type Presented = { [field: string]: JSONValue | undefined };

/**
 * The keys a document is grouped by: the original it is a copy of, and the series it belongs to. A build that groups
 * documents supplies them (`SourceOrigin.keys`); without one, every document stands alone.
 */
export type SourceKeys = { originKey: string | null; seriesKey: string | null };

/** What a build's `keys` is given: the source's whole text and its presentation, raw and as its reader read it. */
export type KeysRead<P extends Presented> = { text: string; presentation: unknown; read: P | null };

/**
 * What a build knows about its own connectors' sources, asked before the generic rule: a provider id an older writer
 * kept only in the event's key (and the link it makes), a workspace whose collections share provider ids (the native id
 * is then scoped by the collection), the lead its writers put before a source's own words, and a kind by connector.
 * Without rules a source is what it states: its native id, its link, its first line, its kind by event kind.
 */
export type SourceRules = {
  recoveredId?: (event: Revision) => string | undefined;
  recoveredLink?: (event: Revision, recoveredId: string) => string | undefined;
  scopesNativeId?: (event: Revision) => boolean;
  titleText?: (event: Revision, text: string) => string;
  kind?: (event: Revision) => string | undefined;
};

/**
 * How a source was written (by a legacy mapper or not), how its presentation is read, how it is keyed, and what the
 * build knows of its connectors.
 */
export type SourceOrigin<P extends Presented> = {
  legacy?: boolean;
  presentation: ReadPresentation<P>;
  keys?: (event: Revision, read: KeysRead<P>) => SourceKeys;
  rules?: SourceRules;
};

const NO_RULES: SourceRules = {};

const NO_KEYS: SourceKeys = { originKey: null, seriesKey: null };

/**
 * A source's listing row, or null when the event is not a source (no text, or not a message, file or record). Its id is
 * the org, connector, workspace and native identity hashed: the same record always lands on the same document.
 */
export function sourceMetadata<P extends Presented>(
  event: Revision,
  orgId: string,
  { legacy = false, presentation: read, keys, rules = NO_RULES }: SourceOrigin<P>,
) {
  if (!["message", "file", "record.change"].includes(event.kind)) return null;
  const body =
    event.body && typeof event.body === "object" ? (event.body as Record<string, unknown>) : {};
  const text =
    typeof body.text === "string" ? body.text : typeof event.body === "string" ? event.body : "";
  if (!text.trim()) return null;
  const presentation = read(body.presentation);
  const { id, nativeId, recoveredId } = identityOf(event, orgId, rules);
  return {
    id,
    nativeId,
    ...(keys?.(event, {
      text,
      presentation: body.presentation,
      read: presentation.success ? presentation.data : null,
    }) ?? NO_KEYS),
    title: titleOf(event, text, rules),
    kind: kindOf(event, rules),
    author: displayAuthor(
      event.source.authorName ??
        event.actor.displayName ??
        event.actor.email ??
        event.actor.sourceUserId,
    ),
    location: event.source.location ?? null,
    url: urlOf(event, recoveredId, rules),
    modifiedAt: event.source.updatedAt ?? event.occurredAt,
    metadataStatus: legacy || !event.source.nativeId ? "legacy" : "native",
    content: text.slice(0, 100_000),
    contentHash: createHash("sha256").update(text).digest("hex"),
    contentTruncated: text.length > 100_000,
    presentation: presentation.success ? presentation.data : null,
  };
}

/**
 * The document's identity. An event without a provider identity stays distinct, since guessing from a title merges
 * unrelated items; where the build's rules say collections share provider ids, the collection scopes the native id.
 */
function identityOf(event: Revision, orgId: string, rules: SourceRules) {
  const recoveredId = rules.recoveredId?.(event);
  const providerId = event.source.nativeId ?? recoveredId ?? `event:${event.id}`;
  const nativeId = rules.scopesNativeId?.(event)
    ? JSON.stringify([event.source.container, providerId])
    : providerId;
  const id = createHash("sha256")
    .update(JSON.stringify([orgId, event.source.connector, event.source.workspace, nativeId]))
    .digest("hex");
  return { id, nativeId, recoveredId };
}

/** The source's own title, else its first non-empty line (after any lead the build's rules strip), else "Untitled source". */
function titleOf(event: Revision, text: string, rules: SourceRules): string {
  const titleText = rules.titleText?.(event, text) ?? text;
  return (
    event.source.title?.trim() ||
    titleText
      .split("\n")
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 160) ||
    "Untitled source"
  );
}

/** The source's own link, else the one a recovered id makes by the build's rules; only a safe URL is kept. */
function urlOf(event: Revision, recoveredId: string | undefined, rules: SourceRules) {
  return safeSourceUrl(
    event.source.ref ?? (recoveredId ? rules.recoveredLink?.(event, recoveredId) : undefined),
  );
}

/** The kind the source states, else the build's by connector, else by event kind. */
function kindOf(event: Revision, rules: SourceRules): string {
  return (
    event.source.type ??
    rules.kind?.(event) ??
    (event.kind === "file" ? "document" : event.kind === "record.change" ? "record" : "message")
  );
}

/**
 * Who wrote a source as a person reads it, or nobody: a placeholder ("unknown", a connector's own `<name>-system`
 * actor) is no author, so the line is left out. A bot is kept, since its name says where a change came from. Applied
 * when a listing row is written and again when it is read.
 */
export function displayAuthor(value: string | null | undefined): string | null {
  const name = value?.trim() ?? "";
  return name === "" || name.toLowerCase() === "unknown" || SYSTEM_ACTOR.test(name) ? null : name;
}
const SYSTEM_ACTOR = /(?:^|-)system$/i;
