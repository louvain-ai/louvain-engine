import type { Block, Model, Turn } from "./model.js";

/**
 * Anthropic's Messages API, called as the scored harness called it: a cache marker after the system text and one on
 * the request, adaptive thinking at the run's effort, and two retries with backoff on a 408, 409, 429 or 5xx, as the
 * SDK it used does. The key is read from `ANTHROPIC_API_KEY` and never written anywhere.
 */
export type ModelSettings = {
  model: string;
  effort: "low" | "medium" | "high";
  maxOutputTokens: number;
};

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const RETRIES = 2;

export function messagesApi(settings: ModelSettings): Model {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the agent's model needs it");
  return async (turn, signal) => {
    const body = JSON.stringify(requestOf(settings, turn));
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(MESSAGES_URL, {
        method: "POST",
        headers: headersOf(key),
        body,
        signal,
      });
      if (res.ok) return replyOf(await res.json());
      const said = await res.text();
      if (attempt >= RETRIES || !(res.status >= 500 || [408, 409, 429].includes(res.status)))
        throw new Error(`${res.status} ${said.slice(0, 300)}`);
      await sleep(delayOf(res.headers.get("retry-after"), attempt), signal);
    }
  };
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

const headersOf = (key: string) => ({
  "content-type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
});

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

/** The server's `retry-after` when it gives a sane one, else half a second doubling, at most eight. */
function delayOf(retryAfter: string | null, attempt: number): number {
  const said = Number(retryAfter);
  return Number.isFinite(said) && said > 0 && said <= 60
    ? said * 1000
    : Math.min(8_000, 500 * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, failed) => {
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      failed(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
