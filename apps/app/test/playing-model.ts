import type { AssistantMessage, Message, Model, ModelEvent } from "../src/ask/model.js";

/** A model for the tests: it plays the turns it is given, and a turn's words may cite what its tools showed it. */

/** The refs a turn's last tool results gave, in order: what a model may cite. */
const refsShown = (messages: readonly Message[]) => {
  const results = [...messages].reverse().find((m) => m.role === "tool");
  const text = results?.role === "tool" ? results.results.map((r) => r.text).join("\n") : "";
  return [...text.matchAll(/^<<document (\w+) \w+>>$/gm)].map((m) => m[1] ?? "");
};

/** What a model's turn writes: fixed words, or words made from the refs its tools showed it. */
type Words = string | ((shown: string[]) => string);

/** A model that plays the turns it is given, one per call, each costing `cost` tokens; `heard` keeps what it read. */
export function playing(
  turns: { text?: Words; calls?: AssistantMessage["calls"] }[],
  cost = 1,
  heard: string[] = [],
): Model {
  let at = 0;
  return {
    name: "playing",
    async *turn(t): AsyncGenerator<ModelEvent> {
      t.signal.throwIfAborted();
      for (const m of t.messages)
        if (m.role === "tool") heard.push(...m.results.map((r) => r.text));
      const { text: words = "", calls: wanted = [] } =
        turns[Math.min(at++, turns.length - 1)] ?? {};
      const text = typeof words === "function" ? words(refsShown(t.messages)) : words;
      if (text) yield { type: "text", text };
      const message: AssistantMessage = { role: "assistant", text, calls: wanted };
      yield {
        type: "done",
        stop: wanted.length ? "calls" : "end",
        message,
        usage: { inputTokens: cost, outputTokens: 0 },
      };
    },
  };
}

export const searching = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: "search_documents",
    input: { query: "lease" },
  }));
