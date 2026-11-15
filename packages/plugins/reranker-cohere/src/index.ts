import { definePlugin, type RerankAsk, type Reranked } from "@louvain/engine-core";
import { z } from "zod";

/**
 * Cohere's Rerank API as the reranker: the search and the candidates' texts go to Cohere (or a gateway speaking its
 * shape, named by its full rerank URL), and a relevance from 0 to 1 per text comes back. The key is read from
 * `COHERE_API_KEY` unless the configuration passes one, so it never has to be written into a file. This model has
 * no cut-off set, so the engine shows its scores and decides what matches as it does without one.
 */
const Settings = z.object({
  model: z.string().min(1).default("rerank-v3.5"),
  url: z.url().default("https://api.cohere.com"),
  timeoutMs: z.number().int().min(500).default(4_000),
  apiKey: z
    .string()
    .default(() => process.env.COHERE_API_KEY ?? "")
    .refine((key) => key.length > 0, "a key is needed: set COHERE_API_KEY, or pass apiKey"),
});
type Settings = z.output<typeof Settings>;

export const cohere = definePlugin({
  kind: "reranker",
  name: "cohere",
  settings: Settings,
  create: (settings) => ({
    model: settings.model,
    rerank: (ask: RerankAsk) => scoredByCohere(settings, ask),
  }),
});

const Answer = z.object({
  results: z.array(z.object({ index: z.number().int(), relevance_score: z.number() })),
});

async function scoredByCohere(settings: Settings, ask: RerankAsk): Promise<Reranked> {
  if (ask.texts.length === 0) return { ok: true, scores: [] };
  const answer = await asked(settings, ask).catch((err: unknown) => ({
    failure: `Cohere's rerank did not answer (${err instanceof Error ? err.message : String(err)})`,
  }));
  if ("failure" in answer) return { ok: false, failure: answer.failure };
  const scores: number[] = ask.texts.map(() => Number.NaN);
  for (const r of answer.results) scores[r.index] = r.relevance_score;
  if (scores.some(Number.isNaN))
    return { ok: false, failure: "Cohere's rerank did not score every text" };
  return { ok: true, scores };
}

/** Cohere's own API is the base URL and `/v2/rerank`; a gateway serving the same shape is named by its full URL. */
async function asked(settings: Settings, ask: RerankAsk) {
  const base = settings.url.replace(/\/$/, "");
  const res = await fetch(/\/rerank$/.test(base) ? base : `${base}/v2/rerank`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, query: ask.query, documents: ask.texts }),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!res.ok) throw new Error(`it answered ${res.status}`);
  return Answer.parse(await res.json());
}
