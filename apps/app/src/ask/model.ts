/**
 * A model: one turn of a conversation in, its words and then one `done` out. Ask's other contract, the answerer, is
 * `answerer.ts`; a strategy that needs a model takes one (`agent({ model })`).
 */

export type Model = {
  /** For activity and usage reports: the provider and model it runs, never a secret. */
  readonly name: string;
  turn(turn: Turn): AsyncIterable<ModelEvent>;
};

export type Turn = {
  readonly system: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens: number;
  readonly signal: AbortSignal;
};

export type Message =
  | { readonly role: "user"; readonly text: string }
  | AssistantMessage
  | { readonly role: "tool"; readonly results: readonly ToolResult[] };

/** `carry` is the provider's own record of the turn (Anthropic's thinking), passed back unchanged, read by no one. */
export type AssistantMessage = {
  readonly role: "assistant";
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly carry?: unknown;
};

type JsonSchema = Readonly<Record<string, unknown>>;
type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly input: JsonSchema;
};
type ToolCall = { readonly id: string; readonly name: string; readonly input: unknown };
type ToolResult = { readonly callId: string; readonly text: string; readonly failed?: true };
type Usage = { readonly inputTokens: number; readonly outputTokens: number };

export type ModelEvent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "done";
      readonly stop: "end" | "calls" | "length" | "refused";
      readonly message: AssistantMessage;
      readonly usage: Usage;
    };
