import { postJson } from "./http.js";
import type { Block, Model, Turn } from "./model.js";

/**
 * Anthropic's Messages API, called as the scored harness called it: a cache marker after the system text and one on
 * the request, adaptive thinking at the run's effort, and the SDK's retries (`http.ts`). The key is read from
 * `ANTHROPIC_API_KEY` and never written anywhere; `ANTHROPIC_BASE_URL`, the name Anthropic's SDKs read, points it
 * elsewhere (a proxy, or a local stand-in).
 */
export type ModelSettings = {
  model: string;
  effort: "low" | "medium" | "high";
  maxOutputTokens: number;
};

export function messagesApi(settings: ModelSettings): Model {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the agent's model needs it");
  const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  return async (turn, signal) =>
    replyOf(
      await postJson(
        { url: `${base}/v1/messages`, headers, body: requestOf(settings, turn) },
        signal,
      ),
    );
}

function requestOf(settings: ModelSettings, turn: Turn) {
  const tools = turn.tools.length > 0;
  return {
    model: settings.model,
    max_tokens: settings.maxOutputTokens,
    system: [{ type: "text", text: turn.system, cache_control: { type: "ephemeral" } }],
    cache_control: { type: "ephemeral" },
    thinking: { type: "adaptive" },
    output_config: { effort: settings.effort },
    ...(tools ? { tools: turn.tools, tool_choice: { type: turn.final ? "none" : "auto" } } : {}),
    messages: turn.messages,
  };
}

type Raw = {
  content?: Block[];
  usage?: Partial<
    Record<
      "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens",
      number
    >
  >;
};

function replyOf(raw: unknown) {
  const { content = [], usage = {} } = raw as Raw;
  return {
    content,
    usage: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    },
  };
}
