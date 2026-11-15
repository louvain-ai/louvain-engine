import type { Clip, ItemPrecision } from "@louvain/engine-core";

/**
 * WHAT A READ HANDS THE READER: one row of evidence, and a recall's page of them. The knowledge core's reads
 * produce it (`ask/evidence.ts`), and the reader, the verifier, the answer log and the receipts consume it.
 */

export type Evidence = {
  id: string;
  /**
   * The TABLE the id belongs to — `relationship` is an open edge the graph walk
   * followed. An edge was emitted as `claim` with a relationship id, so every
   * reader of `tier:id` (the answer log, a saved turn's re-check, provenance,
   * the receipts) looked it up in `claim` and needed a fallback to find it.
   */
  tier: "claim" | "relationship" | "memory" | "passage" | "observation";
  text: string;
  container: string;
  author: string | null;
  /**
   * Did this row's author relay rather than speak first-hand? Carried
   * through so the reader's window can be composed from it, not only ranked by
   * it — a multiplier cannot promote a first-hand row that ranks eighth past a
   * relayed one that ranks first in two lanes.
   */
  relayed: boolean;
  /**
   * An AI agent wrote this row's record. It is shown to the reader as that, it ranks as
   * relayed, and the verifier never lets it be the ONLY support for a figure, date or name without
   * the sentence saying so (`verifySentences`).
   */
  generated?: boolean;
  /** The row's record is read as Reference — cited, and nothing in it is a fact. */
  reading?: "reference";
  /** Instruction-like text in the record (`injection_flag`): the reader quotes it and never follows it. */
  instructionLike?: { marker: string };
  /** Read off an image of the record's page by OCR: cited by that page, never learned from. */
  readOff?: { page: number; by?: "vision" };
  /** Valid time where the tier has one, else the source message time. */
  occurredAt: string;
  /** How much of `occurredAt` the source knew (its precision column); absent is the whole instant. */
  occurredPrecision?: Exclude<ItemPrecision, "instant">;
  score: number;
  /**
   * For the consolidated tier: the memory ids this row generalises over. A summary cannot corroborate a figure, so the
   * reader can ask for its sources instead of retrieval guessing in advance which questions need detail.
   */
  supporting?: string[];
  /**
   * Typed tier only: the resolved entity a claim is about. Counting needs an identity: aliases are already merged, so
   * two spellings of one thing count once. `aggregate` counts these and nothing else.
   */
  subjectId?: string;
  subjectName?: string;
  /**
   * The event this row was written from. A memory is a paraphrase and can lose exactly the detail a question asks for;
   * the verbatim sentence is in the passage tier under the same event, so the reader can ask for it.
   */
  eventId?: string;
  /**
   * WHICH ORIGINAL that event is a copy of (keyed by the build that groups
   * copies) — the same on every copy of one message, however many
   * connections delivered it, and absent where the source has no verified
   * identity. Stamped once per page from the fenced rows' own documents.
   */
  origin?: string;
  /** For a fact: the sentence it was extracted from, verbatim. */
  quote?: string;
  /**
   * The row's text is LESS THAN ITS SOURCE (`@louvain/engine-core`): an excerpt cut around
   * the question, or a source that was itself cut short at import. Every surface that
   * shows the row to a model says so in its header, and an absence the model then writes
   * about it is not a finding. Absent is the whole source.
   */
  clip?: Clip;
  /**
   * Names the source message used that this paraphrase dropped. Extraction is the only place that sees both, so it
   * records them and they travel with the row; without them a question about a dropped name has no answer here.
   */
  droppedNames?: string[];
};
