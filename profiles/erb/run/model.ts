/**
 * The model's side of a turn, in the shape of Anthropic's Messages API: content blocks in and out, and the assistant's
 * blocks sent back exactly as they came (thinking included). `messages-api.ts` calls the API; `stubs.ts` stands in.
 */
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: string; [field: string]: unknown };

export type Message = { role: "user" | "assistant"; content: Block[] };

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** One request: the tools stay listed on the last turn, and `final` forbids calling them. */
export type Turn = {
  system: string;
  messages: readonly Message[];
  tools: readonly { name: string; description: string; input_schema: Record<string, unknown> }[];
  final: boolean;
};

export type Model = (
  turn: Turn,
  signal: AbortSignal,
) => Promise<{ content: Block[]; usage: Usage }>;
