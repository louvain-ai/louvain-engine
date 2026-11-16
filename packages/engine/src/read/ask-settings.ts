/**
 * One context per question: what a question resolves to (the readable set, the query vector, the shape, the named
 * entity) is resolved once, lazily, and shared, and what bounds it lives beside them: one deadline every model call is
 * measured against and one budget of model calls, since a chain of individually bounded calls is not bounded. Carried
 * on `AsyncLocalStorage` because it crosses every seam; absent, each consumer computes for itself and bounds each call
 * by its own timeout.
 */

/** Below this much budget a model call is not worth starting. */
export const MIN_CALL_MS = 1_000;

/** Thrown where a model call would start after the budget is spent. Not transient: retrying cannot help. */
export class DeadlineError extends Error {
  override readonly name = "DeadlineError";
  constructor(message = "ask deadline exceeded") {
    super(message);
  }
}

/** The longest known entity the question names, resolved by the caller; the context only remembers it. */
export type NamedEntity = { name: string; kinds: string[] };

/** What a streaming caller may be shown ahead of the final answer. */
export type SentenceHooks = {
  /** A sentence the verifier accepted against the same evidence the final answer is checked against. */
  onSentence?: (s: { index: number; text: string; cited: string }) => void;
  /** A sentence struck: how many of its tokens were unsupported, never the tokens themselves. */
  onStrike?: (s: { index: number; unsupported: number }) => void;
};

/**
 * What one answer may spend, per mode, as far as the engine reads it: the table of modes is `search/modes.ts`
 * (`askSettings`). An application's reader extends it with its own fields.
 */
export type AskSettings = {
  /** Documents handed to the reader whole (with `LOUVAIN_READ_DOCUMENTS`). */
  documents: number;
  /** Documents added by searching the top documents' containers again. */
  neighbours: number;
  /** Characters of a document's own text handed to the reader, per document. */
  documentChars: number;
  /** Re-order the top documents with the cross-encoder, when one is configured. */
  rerank: boolean;
  /**
   * How much retrieval the question may ask for before any model reads it: `full` is every leg; `bounded` is the vector
   * legs, the narrow lexical pass and registered retrievers, nothing that multiplies queries after the first pass.
   * Read from the mode's settings, so the mode table stays the one place a mode is defined.
   */
  recall: "bounded" | "full";
  deadlineMs: number;
};
