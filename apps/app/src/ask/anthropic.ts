import Anthropic from "@anthropic-ai/sdk";
import type { AssistantMessage, Message, Model, ModelEvent, Turn } from "./model.js";

/**
 * Anthropic's Messages API as a `Model`: one streamed turn, with the person's own key. The model's whole reply is the
 * turn's `carry`, sent back as it came, its reasoning included, which a tool loop must do. A refusal falls back
 * server-side to the model the API picks for it. Thinking stays on and counts in `max_tokens`.
 */

type Params = Anthropic.Beta.MessageCreateParams;
type Content = Params["messages"][number]["content"];

function toApi(message: Message): Params["messages"][number] {
  if (message.role === "user") return { role: "user", content: message.text };
  if (message.role === "tool")
    return {
      role: "user",
      content: message.results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.callId,
        content: r.text,
        is_error: r.failed ?? false,
      })),
    };
  // An earlier answer in a thread is a whole reply, and only its words are carried.
  return { role: "assistant", content: (message.carry ?? message.text) as Content };
}

const STOPS = {
  end_turn: "end",
  tool_use: "calls",
  max_tokens: "length",
  refusal: "refused",
} as const;

/** One turn as the Messages API takes it: its tools streamed eagerly, medium effort, the server's fallback. */
const request = (model: string, t: Turn) => ({
  model,
  max_tokens: t.maxTokens,
  system: t.system,
  messages: t.messages.map(toApi),
  tools: t.tools.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.input as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  })),
  output_config: { effort: "medium" as const },
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
});

/** The finished reply as the contract's `done`: its words, its tool calls, why it stopped and what it cost. */
function doneOf(reply: Anthropic.Beta.BetaMessage): Extract<ModelEvent, { type: "done" }> {
  const message: AssistantMessage = {
    role: "assistant",
    text: reply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
    calls: reply.content.flatMap((b) =>
      b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : [],
    ),
    carry: reply.content,
  };
  const u = reply.usage;
  const inputTokens =
    u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const stop = STOPS[reply.stop_reason as keyof typeof STOPS] ?? "refused";
  return { type: "done", stop, message, usage: { inputTokens, outputTokens: u.output_tokens } };
}

export function anthropic(o: { apiKey: string; model: string }): Model {
  // No retries of its own: the limits around a turn are the only place that decides to spend again.
  const client = new Anthropic({ apiKey: o.apiKey, maxRetries: 0 });
  return {
    name: `anthropic ${o.model}`,
    async *turn(t): AsyncGenerator<ModelEvent> {
      const stream = client.beta.messages.stream(request(o.model, t), { signal: t.signal });
      for await (const event of stream)
        if (event.type === "content_block_delta" && event.delta.type === "text_delta")
          yield { type: "text", text: event.delta.text };
      yield doneOf(await stream.finalMessage());
    },
  };
}
