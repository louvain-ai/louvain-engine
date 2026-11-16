import type { AskMode } from "@louvain/engine-core";
import type { AskSettings, NamedEntity, SentenceHooks } from "./ask-settings.js";
import type { QuestionReading } from "./question-names.js";

export type AskContext = {
  /** Sanitised, as every fence sees it. */
  readonly principal: string;
  readonly orgId: string;
  readonly question: string;
  /** The effective as-of for retrieval: the question's own date when it named one. */
  readonly asOf: string | undefined;
  readonly startedAt: number;
  readonly deadline: number;
  /** How much this answer may spend — see `search/modes.ts`. */
  readonly mode: AskMode;
  readonly settings: AskSettings;
  /** Milliseconds of budget left; zero once spent, and zero once the asker has gone. */
  remaining(): number;
  /** This question's per-reader-call ceiling, from its own deadline. */
  readerCallMs(): number;
  /**
   * Aborted when the person asking has gone — a stream whose client closed.
   * Every model call's own signal is combined with it (`callSignal`), and the
   * budget reads as spent the moment it fires, so nothing further is started
   * or billed for an answer nobody will read.
   */
  readonly signal: AbortSignal | undefined;
  /** Model calls made, against the question's budget. */
  readonly calls: { used: number; max: number };
  /**
   * Take one model call from the budget. False when the calls are spent or
   * the deadline is too close to start one — the caller then skips the call,
   * and a skipped call is counted so an operator can see the budget biting.
   */
  admitCall(purpose: string): boolean;
  /** The asker's readable set, resolved once. */
  containers(): Promise<string[]>;
  /** A query's pgvector literal, embedded once per distinct text. */
  vector(text: string): Promise<string>;
  /** The language service's reading of the question, asked once. */
  shape(): Promise<QuestionReading | null>;
  /** The phrases the question names as specific things, decided once; null when the capital-letter pattern decides. */
  subjects(): Promise<string[] | null>;
  /** The entity the question names, resolved once. */
  entity(): Promise<NamedEntity | undefined>;
  /** Search queries the reader has already run for this question, normalised. */
  readonly searched: Set<string>;
  /** Seconds per stage, accumulated by `stage()`, for the caller to record with the answer. */
  readonly timings: Record<string, number>;
  readonly hooks: SentenceHooks;
};
