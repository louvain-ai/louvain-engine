import { createHash } from "node:crypto";
import { safeSourceUrl } from "@louvain/engine-core";
import type { Revision } from "../../ingest/revision.js";
import type { Presented, SourceKeys, SourceOrigin, SourceRules } from "./metadata-types.js";

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
