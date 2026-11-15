import { z } from "zod";

/** A record as a read hands it over, and the span of its text a citation points at. */

/** Character offsets into the record's text (`event_log.body->>'text'`), end exclusive. */
export const Span = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .refine((s) => s.end > s.start, "a span must be non-empty");
export type Span = z.infer<typeof Span>;

/** A structured record's payload as the source handed it over: packages validate each part. */
export type StructuredPayloadView = {
  facts: readonly unknown[];
  snapshots: readonly unknown[];
  /** The predicates the event states completely for its record. */
  factsComplete?: readonly unknown[];
};

/**
 * What a step is handed about a record. `container` is the permission unit; steps read it, never set it.
 *
 * `text` is what spans index. For a content record it is `body.text`. For a STRUCTURED record it is the rendering
 * of its facts and snapshots that the accept path stored beside them (`event_log.structured.text`), after any body
 * text and a blank line — stored, never re-rendered on read, so a committed span keeps pointing at the words it
 * cited when a predicate label is renamed (`records.ts` `recordText`).
 *
 * The fields after `labels` are optional in the type only so a synthetic fixture need not state them; every record
 * the core loads carries all of them (an absent source value is `null`, `false` or empty).
 */
export type RecordView = {
  id: string;
  orgId: string;
  container: string;
  connector: string;
  kind: string;
  occurredAt: string;
  author: string;
  text: string;
  /** Presentation data from the source (email headers, thread ids…); untrusted. */
  presentation: Record<string, unknown>;
  /** Labels committed by earlier steps, by key. */
  labels: Record<string, unknown>;
  /** `event_log.observed_at`: when the source was seen to say it, which is knowledge time (`AsOf.knownAt`). */
  observedAt?: string;
  /** `event_log.workspace`: the source's own boundary, which scopes a source's native ids. */
  workspace?: string;
  /** `event_log.record_key` (`<objectType>:<nativeId>`): what a structured record's earlier events are found by. */
  recordKey?: string | null;
  /** Who wrote it, as the source stated: an address, a display name, and whether the source says it relays. */
  actor?: { email: string | null; displayName: string | null; relays: boolean };
  /** The facts and snapshots a structured source handed over, or null. */
  structured?: StructuredPayloadView | null;
};
