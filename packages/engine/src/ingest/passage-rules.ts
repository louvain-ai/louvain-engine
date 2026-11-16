/**
 * How a build's records become passages, handed to a write in its hooks (`writes.ts` `WriteHooks.passageRules`): the
 * parts of a text cut on their own, the header a record's passages carry, which events may be indexed, which of an
 * event's passages its own text wrote, and whether a passage's context is also embedded. A write handed none reads
 * `openPassageRules`: a text is one part, headed by its title and section path, every event is indexable, every passage
 * is its text's, and a context is text only.
 */
import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../store/sql.js";
import { documentHeader, type HeaderDocument, passageHeaders } from "./passage-context.js";

type Fragment = PendingQuery<Row[]>;

export type PassageRules = {
  /** The parts of a text cut on their own, in order. */
  parts(text: string): string[];
  /** The header every passage of a record shares, which its keyword entry carries too; null when it says nothing. */
  documentHeader(record: HeaderDocument): string | null;
  /** Each chunk's header, by where it falls in its record. */
  passageHeaders(record: HeaderDocument, chunks: readonly string[]): (string | null)[];
  /** What an `event_log` row must satisfy to be indexed; null: every event is. */
  indexable: ((q: Queryable) => Fragment) | null;
  /** Which of an event's passages its own text wrote, when the build writes others beside them; null: all of them. */
  textRows: ((q: Queryable) => Fragment) | null;
  /**
   * The column a passage's context VECTOR is kept in (the context embedded with the chunk), for a build that keeps
   * one; null: none. A context is always written as text, for the keyword passes and the keyword index's header. The
   * vector leg ranks by the bare vector alone, so a build that reads no context vector embeds no context: one
   * embedding per chunk, not two.
   */
  contextVector: string | null;
  /**
   * The words a build's database keeps of a passage beside its context, where it matches text there (its column, and
   * its value over the context and the text). Null: the open build's keyword index is its one matcher, and its database
   * keeps no words.
   */
  contextWords: {
    column: string;
    of(q: Queryable, context: Fragment, text: Fragment): Fragment;
  } | null;
};

export const openPassageRules: PassageRules = {
  parts: (text) => [text],
  documentHeader: documentHeader,
  passageHeaders,
  indexable: null,
  textRows: null,
  contextVector: null,
  contextWords: null,
};

/** An index's condition on the event row (`and …`), or nothing where every event is indexable. */
export function indexableRevision(rules: PassageRules, q: Queryable): Fragment {
  const rule = rules.indexable;
  return rule ? q`and ${rule(q)}` : q``;
}

/** The context vector cleared (`<column> = null,`) where the build keeps one, or nothing. */
export function contextVectorNull(rules: PassageRules, q: Queryable): Fragment {
  const col = rules.contextVector;
  return col ? q`${q(col)} = null,` : q``;
}

/** The condition that keeps a rewrite to the passages its text wrote (`and …`), or nothing where it wrote them all. */
export function textRows(rules: PassageRules, q: Queryable): Fragment {
  const rule = rules.textRows;
  return rule ? q`and ${rule(q)}` : q``;
}
