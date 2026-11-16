import { createHash } from "node:crypto";
import { clip, isObject, str } from "../text/words.js";
import { chunkPlaces, headingsOf, pathAt } from "./passage-sections.js";

/**
 * A passage may carry what situates it (its record's title and section), and it is never the passage: the
 * context is prepended only to the text that is embedded and indexed, while `passage.text` stays the verbatim chunk a
 * citation quotes. The context is built only from the passage's own record, a pure function of its text, presentation
 * and listing row, so words a reader cannot see never change what a passage they can see is found for. It lives on the
 * passage row, read under the passage's fence, and goes when the row goes. The contextual vector is written and not
 * read; the lexical context is read. Which workspaces write it is their mode (`store/context-mode.ts`); a
 * build may head its records its own way (`ingest/passage-rules.ts`).
 */

/** What a header may be built from: the passage's OWN record, and only these fields of it. */
export type HeaderDocument = {
  /** `event_log.body.text` — the string the passages were cut from. */
  text: string;
  /** `event_log.body.presentation`. Untrusted presentation data; here it only ever becomes search text. */
  presentation: Record<string, unknown>;
  /** `event_log.connector`. */
  connector: string;
  /**
   * The SAME event's listing row (`source_revision`, written once per event from its own `source` block) and its
   * valid time: the record's own metadata, never another record's. Optional: a record read before it was listed
   * is headed from its presentation alone.
   */
  meta?: DocumentMeta;
};

export type DocumentMeta = {
  /** `source_revision.kind` — the source's own type (`slack`, `jira`, `gmail`, `confluence`, …). */
  kind?: string | null;
  title?: string | null;
  author?: string | null;
  location?: string | null;
  /** `event_log.occurred_at`, ISO. */
  occurredAt?: string | null;
};

/**
 * A context plus a chunk must stay under the embedding model's token cut, which drops text silently from the right, so
 * an over-long context would cost the chunk its last sentences. 400 characters is about 100 tokens of English.
 */
export const MAX_CONTEXT_CHARS = 400;
/** The header itself stays short: what situates a chunk is a line, not a paragraph. */
export const MAX_HEADER_CHARS = 200;
const TITLE_CHARS = 120;
const PATH_CHARS = 120;

/**
 * Version of the header's recipe: a change to what a header says is a new key, so every header is rebuilt. A header is
 * built from the record's own presentation and listing row, so a record with no presentation is headed too.
 */
const HEADER_VERSION = 2;

/** What a record is called by what it states: its document's name, else its key and its listing's title. */
function titleOf(record: HeaderDocument): string {
  const doc = isObject(record.presentation.document) ? record.presentation.document : null;
  const named = doc ? str(doc.filename) || str(doc.title) || str(doc.name) : "";
  const keyed = [keyOf(record), str(record.meta?.title)].filter(Boolean).join(" · ");
  return clip(named || keyed, TITLE_CHARS);
}

/** A record's key, where its presentation states one: its field labelled `key` (`ingest/item-event.ts`). */
function keyOf(record: HeaderDocument): string {
  const shown = record.presentation.record;
  const fields = isObject(shown) && Array.isArray(shown.fields) ? shown.fields : [];
  return str(fields.find((f) => isObject(f) && f.label === "key")?.value);
}

/** The header a record's passages share and its keyword entry carries: its title, or null when it states none. */
export function documentHeader(record: HeaderDocument): string | null {
  return titleOf(record) || null;
}

/**
 * The header for each chunk, or null; pure: the record's title, then the section path where the chunk's middle falls,
 * at most `MAX_HEADER_CHARS`. A record that states neither gets no header and pays no second embedding.
 */
export function passageHeaders(
  record: HeaderDocument,
  chunks: readonly string[],
): (string | null)[] {
  const title = titleOf(record);
  const headings = headingsOf(record);
  const places = chunkPlaces(record.text, chunks);
  return chunks.map((_, i) => {
    // A chunk is placed by its MIDDLE: one that opens on the last sentences of "Scope" and runs on into "Fees"
    // is about fees, and headed as the section most of its words are in.
    const at = places[i]?.mid;
    const path = at === undefined ? [] : pathAt(headings, at);
    const section = clip(path.filter((p) => p !== title).join(" › "), PATH_CHARS);
    const head = [title, section].filter(Boolean).join(" › ");
    return head ? clip(head, MAX_HEADER_CHARS) : null;
  });
}

/** The stored context: the header, inside the budget. */
export function composeContext(header: string | null): string | null {
  return header ? clip(header, MAX_CONTEXT_CHARS) : null;
}

/** What a stored context was built from. Equal keys mean an equal context, so nothing is embedded again. */
export function contextKey(context: string): string {
  const digest = createHash("sha256").update(context).digest("hex").slice(0, 32);
  return `header@${HEADER_VERSION}:${digest}`;
}
