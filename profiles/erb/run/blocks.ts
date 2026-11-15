import type { Block } from "./model.js";

/** A reply's words: its text blocks, joined. Thinking blocks are the model's record, never the answer. */
export const textOf = (blocks: readonly Block[]): string =>
  blocks.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");

export type Call = { id: string; name: string; input: Record<string, unknown> };

/** A reply's tool calls, in the order the model asked for them. */
export const callsOf = (blocks: readonly Block[]): Call[] =>
  blocks.flatMap((b) =>
    b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string"
      ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }]
      : [],
  );
