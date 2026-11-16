import type { Span } from "@louvain/engine-core";
import type { KnownPrecision } from "./precision.js";

/**
 * What every read primitive shares: the evidence shape, the as-of instant and the embedder.
 */

// ———————————————————————————— as of ————————————————————————————

/**
 * When the question is asked about, and when it is asked from: a bare string is `validAt`, the instant the answer is
 * about; `knownAt` is what the system had recorded by then, applied in the read. The read layer only normalises and
 * passes it on.
 */
export type { AsOf } from "@louvain/engine-core";

// ———————————————————————————— evidence ————————————————————————————

/** Who said it: the entity bound as its speaker, if any, and the record's author as the source names them. */
export type Speaker = {
  entityId: string | null;
  label: string | null;
  /** The record's actor (an address, a chat user id), as `event_log.actor_id` stores it. */
  author: string | null;
};

/**
 * Every result is evidence: what it is, the record it came from, where in that record's text, who said it, when, the
 * collection that fenced it, the words, and any entities it binds that this viewer can see. Nothing reaches an
 * evidence object without passing the fence. `span` is null only where the words cannot be located or a whole record
 * is meant; `origin` names the original the record is a copy of.
 */
export type Evidence = {
  kind: "statement" | "passage" | "record";
  recordId: string;
  span: Span | null;
  speaker: Speaker | null;
  occurredAt: string;
  /** How much of `occurredAt` the source knew; absent is the whole instant. */
  occurredPrecision?: KnownPrecision;
  container: string;
  text: string;
  /** The id a citation is rechecked by, where the result has one. */
  statementId?: string;
  /**
   * For a passage: its id. On the shared shape, not only on `PassageHit`, because a caller renders a cited row from
   * an `Evidence` whatever produced it, and keys the row on this to recheck it or open the source at that passage.
   */
  passageId?: string;
  /** The frame a typed result fills; null for a note. */
  frame?: string | null;
  /** The entities the result binds that exist for this viewer (canonical ids); empty for a passage. */
  entityIds?: string[];
  origin?: string;
  /** An AI agent wrote the record: shown as that, and never the only support for a claim. */
  generated?: true;
  /** The record is read as reference: cited, and folds into nothing. Fails closed to set. */
  reading?: "reference";
  /**
   * A passage read off an image of the record (OCR or a vision model), not the record's own text: cited by its page,
   * never by a span, and never learned from. Its words are a reading of the image.
   */
  readOff?: { page: number; by?: "vision" };
  /**
   * The record's text carries instruction-like wording (`generated.ts` `instructionLikeRevisions`): the marker it hit,
   * never its text. Every reader quotes such a passage and never follows it. Fails closed to set.
   */
  instructionLike?: { marker: string };
};

// ———————————————————————————— terms ————————————————————————————

/**
 * A query's terms for the lexical legs: lower case, split on anything not a letter or digit, words of three
 * characters or more. A build's Postgres passes OR them wide and AND the longest narrow.
 */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    ),
  ];
}
