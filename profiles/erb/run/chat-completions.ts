import { postJson } from "./http.js";
import type { Block, Message, Model, Turn } from "./model.js";

/**
 * An OpenAI-compatible chat-completions endpoint as the agent's model: any host that serves the model, a provider's or
 * your own vLLM or SGLang, named by its base URL. The loop's turns are in the Messages shape (`model.ts`), so each
 * is said here as chat messages and the reply said back as blocks: text as text, a `tool_use` as a tool call, a
 * `tool_result` as a `tool` message, `final` as `tool_choice: "none"`. Nothing else crosses: no thinking, no effort,
 * no cache markers. The key is read from the environment variable the settings name and never written anywhere.
 */
export type ChatSettings = {
  baseUrl: string;
  model: string;
  keyVariable: string;
  maxOutputTokens: number;
};

export function chatCompletions(settings: ChatSettings): Model {
  const key = process.env[settings.keyVariable];
  if (!key) throw new Error(`${settings.keyVariable} is not set: the agent's model needs it`);
  const url = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { authorization: `Bearer ${key}` };
  return async (turn, signal) =>
    replyOf(await postJson({ url, headers, body: requestOf(settings, turn) }, signal));
}

function requestOf(settings: ChatSettings, turn: Turn) {
  const tools = turn.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  return {
    model: settings.model,
    max_tokens: settings.maxOutputTokens,
    messages: [{ role: "system", content: turn.system }, ...turn.messages.flatMap(chatOf)],
    ...(tools.length > 0 ? { tools, tool_choice: turn.final ? "none" : "auto" } : {}),
  };
}

const textOf = (blocks: readonly Block[]) =>
  blocks
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("\n\n");

/** One loop message as chat messages: a user's tool results come first, as `tool` messages, then any text it carries. */
function chatOf(m: Message): Record<string, unknown>[] {
  if (m.role === "assistant") {
    const calls = m.content.flatMap((b) =>
      b.type === "tool_use"
        ? [
            {
              id: b.id,
              type: "function",
              function: { name: b.name, arguments: JSON.stringify(b.input) },
            },
          ]
        : [],
    );
    return [
      {
        role: "assistant",
        content: textOf(m.content) || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      },
    ];
  }
  const results = m.content.flatMap((b) =>
    b.type === "tool_result"
      ? [{ role: "tool", tool_call_id: b.tool_use_id, content: b.content }]
      : [],
  );
  const text = textOf(m.content);
  return [...results, ...(text ? [{ role: "user", content: text }] : [])];
}

type Raw = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function replyOf(raw: unknown) {
  const { choices = [], usage = {} } = raw as Raw;
  const message = choices[0]?.message ?? {};
  const content: Block[] = [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...(message.tool_calls ?? []).map((c) => ({
      type: "tool_use" as const,
      id: c.id,
      name: c.function.name,
      input: argumentsOf(c.function.arguments),
    })),
  ];
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    usage: {
      input: (usage.prompt_tokens ?? 0) - cached,
      output: usage.completion_tokens ?? 0,
      cacheRead: cached,
      cacheWrite: 0,
    },
  };
}

/** A call's arguments; ones that are not a JSON object reach the tool as none, and the tool says what it lacks. */
function argumentsOf(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
