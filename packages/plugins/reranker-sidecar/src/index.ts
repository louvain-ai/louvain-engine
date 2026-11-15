import {
  definePlugin,
  type RelevanceCutoffs,
  type RerankAsk,
  type Reranked,
} from "@louvain/engine-core";
import { z } from "zod";
import { DEFAULT_MODEL, MODELS } from "./models.js";

export { DEFAULT_MODEL, MODELS } from "./models.js";

/**
 * The local reranker: a small open-weights cross-encoder in the rerank sidecar, on this machine. The search and the candidates' texts go to it and nothing leaves the machine. The sidecar answers a raw
 * score per text, squashed here into [0, 1] by the logistic function the model is trained with, and names its model,
 * so a cut-off measured on one model is never applied to another's scores.
 */
const Settings = z.object({
  url: z.url(),
  model: z.string().min(1).default(DEFAULT_MODEL),
  timeoutMs: z.number().int().min(500).default(4_000),
  /** How much of the order is the reranker's; left out, the shipped model's own (`MODELS`), else the engine's. */
  blend: z.number().min(0).max(1).optional(),
  /** The sidecars' shared bearer, when the stack sets one. */
  token: z.string().default(() => process.env.LOUVAIN_SIDECAR_TOKEN ?? ""),
});
type Settings = z.output<typeof Settings>;

export const sidecar = definePlugin({
  kind: "reranker",
  name: "sidecar",
  settings: Settings,
  create: (settings) => {
    const cutoffs: RelevanceCutoffs | undefined = MODELS[settings.model]?.cutoffs;
    const blend = settings.blend ?? MODELS[settings.model]?.blend;
    return {
      model: settings.model,
      ...(cutoffs ? { cutoffs } : {}),
      ...(blend === undefined ? {} : { blend }),
      rerank: (ask: RerankAsk) => scoredBySidecar(settings, ask),
    };
  },
});

const Answer = z.object({
  model: z.string().optional(),
  results: z.array(z.object({ id: z.string(), score: z.number() })),
});

async function scoredBySidecar(settings: Settings, ask: RerankAsk): Promise<Reranked> {
  if (ask.texts.length === 0) return { ok: true, scores: [] };
  const answer = await asked(settings, ask).catch((err: unknown) => ({
    failure: `the rerank sidecar at ${settings.url} did not answer (${err instanceof Error ? err.message : String(err)})`,
  }));
  if ("failure" in answer) return { ok: false, failure: answer.failure };
  if (answer.model !== settings.model)
    return {
      ok: false,
      failure: `the rerank sidecar runs ${answer.model ?? "an unnamed model"}, not ${settings.model}`,
    };
  const scores: number[] = ask.texts.map(() => Number.NaN);
  for (const hit of answer.results) scores[Number(hit.id)] = 1 / (1 + Math.exp(-hit.score));
  if (scores.some(Number.isNaN))
    return { ok: false, failure: "the rerank sidecar did not score every text" };
  return { ok: true, scores };
}

async function asked(settings: Settings, ask: RerankAsk) {
  const res = await fetch(`${settings.url.replace(/\/$/, "")}/rerank`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}),
    },
    body: JSON.stringify({
      query: ask.query,
      documents: ask.texts.map((text, i) => ({ id: String(i), text })),
    }),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!res.ok) throw new Error(`it answered ${res.status}`);
  return Answer.parse(await res.json());
}
