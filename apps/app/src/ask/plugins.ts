import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";
import { agent as toolLoop } from "./agent.js";
import { anthropic as anthropicModel } from "./anthropic.js";
import { type Unready, unready } from "./contract.js";
import { limitsFrom } from "./limits.js";
import type { Model } from "./model.js";

export { scripted } from "./scripted.js";

/**
 * The answerers a configuration names, as values: `engine.config.ts` writes
 * `answerer: agent({ model: anthropic({ model: "claude-sonnet-5-5" }) })`, or `scripted()`, which needs no model, or
 * one of its own made with `definePlugin`. None named, Ask says it has no answerer. The environment carries the key
 * alone: a model without one is `Unready`, the agent over it starts not ready, and Ask says which setting it needs.
 */

/** Anthropic's model by name, with the key in `ANTHROPIC_API_KEY`; without a key, the setting Ask needs. */
export function anthropic(o: { model: string }): Model | Unready {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? anthropicModel({ apiKey, model: o.model }) : { needs: "ANTHROPIC_API_KEY" };
}

const isModel = (value: unknown): value is Model | Unready =>
  typeof value === "object" &&
  value !== null &&
  (typeof (value as Model).turn === "function" || typeof (value as Unready).needs === "string");

/** The tool loop over any model, held to an answer's limits (`limits.ts`). */
export const agent = definePlugin({
  kind: "answerer",
  name: "agent",
  settings: z.object({
    model: z.custom<Model | Unready>(isModel, "a model, such as anthropic({ model })"),
  }),
  create: ({ model }) =>
    unready(model)
      ? { notReady: model.needs }
      : toolLoop({ model, limits: limitsFrom(process.env) }),
});
