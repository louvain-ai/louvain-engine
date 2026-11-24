import { createHash } from "node:crypto";
import { safeSourceUrl } from "@louvain/engine-core";
import type { Revision } from "../../ingest/revision.js";
import { documentShape } from "../../text/record-shape.js";
import { type ChatTitleInput, chatPlace, chatTitle, standsInForTitle } from "./chat-title.js";
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

/**
 * The source's own title, else its first non-empty line (after any lead the build's rules strip), else "Untitled
 * source". A CHAT message whose source states no title of its own (none, its channel, a bare time, its raw first line)
 * is titled by its opening sentence beside its place, `<place> · <sentence>` (`chat-title.ts`; the build's `chatTitle`
 * first): the place stays in the title because a search hit and a citation show the title alone. With no sentence to
 * take it is the place, except a message that is only a link, which keeps the link (a listing shows the link's preview
 * in its place). Chat is `documentShape`'s word for it, the one rule every reader of a record's kind uses.
 */
function titleOf(event: Revision, text: string, rules: SourceRules): string {
  const titleText = rules.titleText?.(event, text) ?? text;
  const stated = event.source.title?.trim() ?? "";
  const firstLine =
    titleText
      .split("\n")
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 160) ?? "";
  const body =
    event.body && typeof event.body === "object" ? (event.body as { presentation?: unknown }) : {};
  const p = isRecord(body.presentation) ? body.presentation : {};
  const shape = documentShape({
    presentation: p,
    connector: event.source.connector,
    kind: kindOf(event, rules),
  });
  if (shape !== "chat") return stated || firstLine || "Untitled source";
  const place = chatPlace(event.source.location, p.channel, {
    title: stated,
    container: event.source.container,
  });
  if (!standsInForTitle(stated, { firstLine, place })) return stated;
  return (
    saidTitle(event, { text: titleText, place }, rules) ?? fallbackTitle(stated || firstLine, place)
  );
}

/** A chat message's own words as its title, the build's first, beside its place; null when it says nothing. */
function saidTitle(event: Revision, read: ChatTitleInput, rules: SourceRules): string | null {
  const said = rules.chatTitle?.(read, event) ?? chatTitle(read);
  if (!said) return null;
  return read.place ? `${read.place} · ${said}` : said;
}

/** A chat message that says nothing is its place, unless it is only a link (the listing shows the link's preview). */
const fallbackTitle = (shown: string, place: string | null): string =>
  BARE_LINK.test(shown) ? shown : (place ?? (shown || "Untitled source"));
const BARE_LINK = /^<?https?:\/\/\S+>?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
 *
 * Nor is a connection's own subject (`installer-<connection uuid>`): an identifier for a connection's owner, never
 * words. A message that stated no name fell back to it, and its owner read their own messages as sent by the id.
 */
export function displayAuthor(value: string | null | undefined): string | null {
  const name = value?.trim() ?? "";
  return name === "" ||
    name.toLowerCase() === "unknown" ||
    SYSTEM_ACTOR.test(name) ||
    CONNECTION_SUBJECT.test(name)
    ? null
    : name;
}
const SYSTEM_ACTOR = /(?:^|-)system$/i;
/** A connection's own subject: `installer-` and the connection's uuid. */
const CONNECTION_SUBJECT =
  /^installer-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
