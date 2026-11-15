import { createRemote, type RemoteOptions, type RemoteSettings } from "../src/remote.js";
import {
  EmbeddingsSettings,
  type EmbeddingsSettingsValue,
  modelSettingsOf,
} from "../src/settings.js";

/** Settings parsed from these variables alone, as an embedder is made from them: nothing read from the process. */
export const settingsOf = (env: Record<string, string | undefined> = {}): EmbeddingsSettingsValue =>
  EmbeddingsSettings.parse(env);

/** A remote client over these variables alone, with a pause that waits for nothing. */
export function remoteOf(
  env: Record<string, string | undefined>,
  options: RemoteOptions = {},
): ReturnType<typeof createRemote> {
  const s = settingsOf(env);
  const settings: RemoteSettings = {
    endpoint: s.LOUVAIN_EMBEDDINGS_URL,
    bulkEndpoint: s.LOUVAIN_EMBEDDINGS_BULK_URL || s.LOUVAIN_EMBEDDINGS_URL,
    timeoutMs: s.LOUVAIN_EMBEDDINGS_TIMEOUT_MS,
    bulkTimeoutMs: s.LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS,
    localFallback: s.LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK,
    requestBatch: s.LOUVAIN_EMBEDDINGS_REQUEST_BATCH,
    token: s.LOUVAIN_SIDECAR_TOKEN,
    model: modelSettingsOf(s),
  };
  return createRemote(() => settings, { pause: async () => {}, ...options });
}

type Call = { url: string; init: RequestInit | undefined };

/** Replace `fetch` for one test body; every call is recorded and answered by `answer`. */
export async function withFetch<T>(
  answer: (url: string, init: RequestInit | undefined, n: number) => Response | Promise<Response>,
  body: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  const errors = console.error;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init, calls.length);
  }) as typeof fetch;
  console.error = () => {};
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = real;
    console.error = errors;
  }
}

/** A sidecar's `/embed` answer: one vector per text, the text's number as its only dimension. */
export function vectorsFor(init: RequestInit | undefined): Response {
  const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
  return Response.json({ vectors: texts.map((t) => [Number(t)]) });
}
