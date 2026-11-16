import { keyOfRecord, type RecordRef } from "../plain.js";

/**
 * The kinds that carry CONTENT: text a person wrote, which the engine reads, cuts into passages and cites.
 *
 * Named once, because a question asked in several places gets several answers: a test of `kind = 'message'` alone
 * stores a `file` or a `record.change` and never makes a passage of it, so a connected document store answers
 * nothing and nothing says why. Permission traffic and reactions are not content: the first grants, the second states
 * nothing on its own.
 */
export const CONTENT_EVENT_KINDS = ["message", "file", "record.change"] as const;
export function isContentKind(kind: string): kind is (typeof CONTENT_EVENT_KINDS)[number] {
  return (CONTENT_EVENT_KINDS as readonly string[]).includes(kind);
}
/**
 * The record an event is about, as stored (`event_log.record_key`): only for content and fact-only events.
 * `objectType` cannot contain `:` (the contract refuses it), so the first colon separates the two halves
 * unambiguously. Here, beside `keyOfRecord`, because readers and writers both need it (the open engine
 * reads it without the ingest path).
 */
export function recordKeyOf(ev: {
  kind: string;
  record?: RecordRef | null | undefined;
}): string | null {
  if (!ev.record) return null;
  if (!isContentKind(ev.kind) && ev.kind !== "record.state") return null;
  return keyOfRecord(ev.record);
}
