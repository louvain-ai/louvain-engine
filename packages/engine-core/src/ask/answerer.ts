/**
 * An answerer: a question in, answer events out, through the tools the engine binds for that one answer. What decides
 * sight and spend stays the engine's: which tools it binds, which citations reach the reader, the lookups, the time and
 * the stop. A configuration names one answerer, or none (`EngineConfig.answerer`).
 */
export type Answerer = { answer(ask: AnswerRequest): AsyncIterable<AnswerEvent> };

export type AnswerRequest = {
  readonly question: string;
  readonly history: readonly { readonly question: string; readonly answer: string }[];
  readonly tools: readonly BoundTool[];
  readonly signal: AbortSignal;
};

/** A tool bound for one answer: what a model is told about it, and the call that runs it. */
export type BoundTool = {
  readonly name: string;
  readonly description: string;
  readonly input: Readonly<Record<string, unknown>>;
  run(input: unknown): Promise<BoundResult>;
};

/** What a tool returned, and the documents it showed, each by the ref a citation names it with. */
export type BoundResult = {
  readonly text: string;
  readonly shown: readonly { readonly ref: string; readonly title: string }[];
};

export type AnswerEvent =
  | { readonly type: "activity"; readonly label: string }
  | { readonly type: "text"; readonly text: string }
  /**
   * The words sent so far were thinking aloud ahead of a tool call, not the answer: a reader takes them back. Tool calls
   * arrive only once a model's turn is done, so those words are already shown when they turn out not to be it.
   */
  | { readonly type: "restart" }
  | { readonly type: "cite"; readonly ref: string }
  | { readonly type: "no-answer"; readonly why: "sources-silent" | "refused" | "limit" }
  | {
      readonly type: "done";
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    };
