/**
 * Embedding as a service, when one is configured: the interactive lane (`LOUVAIN_EMBEDDINGS_URL`) takes queries and the
 * bulk lane (`LOUVAIN_EMBEDDINGS_BULK_URL`) ingest, so a question never queues behind a backfill. Local fallback is
 * opt-in, so a saturated sidecar's `503` fails the request for a retry. One client per embedder (`createRemote`): its
 * settings are read on first use, and what it remembers (the last stated bulk space, whether an outage was said) is
 * its own.
 */

import type { SidecarEndpoints } from "@louvain/engine-core";
import {
  EmbeddingFailed,
  type EmbeddingFailure,
  EmbeddingUnavailable,
  httpFailure,
} from "./errors.js";
import type { EmbeddingSettings } from "./settings.js";
import { sidecarDisagreement } from "./space-statement.js";

/** What the remote client is made from. */
export type RemoteSettings = {
  endpoint: string | undefined;
  bulkEndpoint: string | undefined;
  /** The query lane's per-request limit: a question waits on its vector, so a slow sidecar must fail fast. */
  timeoutMs: number;
  /** The bulk lane's per-request limit (180 s default), covering the sidecar's queue as well as inference: a batch job can wait, a question cannot. */
  bulkTimeoutMs: number;
  localFallback: boolean;
  /** Bounds a request's inference time. Results remain ordered across chunks. */
  requestBatch: number;
  /** The shared sidecar bearer (`LOUVAIN_SIDECAR_TOKEN`); a sidecar with a token set refuses `/embed` without it. */
  token: string;
  /** The model's conventions, which a sidecar's `/healthz` must agree with. */
  model: EmbeddingSettings;
};

export type EmbedLane = "interactive" | "bulk";

/** Why a remote embed failed, as a bounded label: never the error's own text, which can carry input. */
export type RemoteFailure = {
  lane: EmbedLane;
  reason: EmbeddingFailure;
};

/**
 * How this embedder reaches its sidecars and tells its host what happened: the deployment's endpoints (unbound, every
 * sidecar is plain HTTP that is always up), who hears every failed remote embed, and the pause between reconnects.
 */
export type RemoteOptions = {
  endpoints?: SidecarEndpoints | undefined;
  onFailure?: ((failure: RemoteFailure) => void) | undefined;
  pause?: ((ms: number) => Promise<void>) | undefined;
};

/**
 * Every sidecar a plain HTTP service that is always up: probed for readiness, sent ordinary requests, used at the
 * address it was given.
 */
const PLAIN_ENDPOINTS: SidecarEndpoints = {
  wakesOnRequest: () => false,
  bulkTransport: () => null,
  queryEndpoint: async (endpoint) => endpoint,
};

/**
 * A bulk request that never connected is retried a few seconds apart and only then fails: a sidecar that
 * stops when idle refuses or resets a connection while it boots or a deploy replaces it, which `fetch` reports as a
 * network `TypeError`. The pauses sum to 15 s, inside the bulk lane's limit; a lane that stays down still fails after
 * them. The query lane is not retried: a question cannot wait out a boot.
 */
const BULK_RECONNECT_PAUSES_MS = [1_000, 2_000, 4_000, 8_000] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Why a remote embed failed: the client's own failures carry their reason; a timeout is the platform's abort. */
function failureReason(err: unknown): EmbeddingFailure {
  if (err instanceof EmbeddingFailed) return err.reason;
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable";
}

/** What one client holds: its settings, how it reaches its sidecars, and what it remembers between requests. */
type Client = {
  settings: () => RemoteSettings;
  endpoints: SidecarEndpoints;
  pause: (ms: number) => Promise<void>;
  onFailure: ((failure: RemoteFailure) => void) | undefined;
  /** Whether this outage was already said: the first failure is logged, the rest only counted. */
  warned: boolean;
  /** The embedding space the bulk lane's most recent response stated. */
  lastBulkSpace: Record<string, unknown> | null;
};

/** Which lanes are configured, how each is reached, and the bearer every request carries. */
function lanesOf(c: Client) {
  const { settings, endpoints } = c;

  /**
   * Whether the bulk lane takes jobs on demand (the deployment's `bulkTransport`): an endpoint that starts a machine
   * when a job comes. Only ever the bulk lane: a query waits on its vector and a cold start is past any answer's
   * deadline.
   */
  function bulkOnDemand(): boolean {
    const { bulkEndpoint } = settings();
    return typeof bulkEndpoint === "string" && endpoints.bulkTransport(bulkEndpoint) !== null;
  }

  /** Whether the address stops when idle and starts on the next request; an unset address never does. */
  function wakesOnRequest(url: string | undefined): boolean {
    return url ? endpoints.wakesOnRequest(url) : false;
  }

  /**
   * Whether a lane's sidecar stops when idle and starts on the next request. Readiness does not probe such a lane,
   * since a probe would start it; `/readyz` reports it configured and unprobed.
   */
  function laneWakesOnRequest(lane: EmbedLane): boolean {
    const { endpoint, bulkEndpoint } = settings();
    return wakesOnRequest(lane === "interactive" ? endpoint : bulkEndpoint);
  }

  /** One job on a bulk lane that takes jobs, through the deployment's transport. Anything but a completed output throws. */
  function onDemandJob(
    endpoint: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const run = endpoints.bulkTransport(endpoint);
    if (!run) throw new Error("embeddings: the bulk lane takes no jobs");
    return run(input);
  }

  /** The bearer, when one is set. A refusal surfaces as `embeddings 401` through the ordinary failure path: the status, never the token. */
  function authHeaders(): Record<string, string> {
    const { token } = settings();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  function remoteConfigured(): boolean {
    const { endpoint } = settings();
    return typeof endpoint === "string" && endpoint.length > 0;
  }

  return {
    bulkOnDemand,
    wakesOnRequest,
    laneWakesOnRequest,
    onDemandJob,
    authHeaders,
    remoteConfigured,
  };
}

type Lanes = ReturnType<typeof lanesOf>;

/** Asking a lane about itself: its `/healthz`, its tokenizer's counts, and whether it is up and agrees. */
function probesOf(c: Client, lanes: Lanes) {
  const { settings } = c;
  const { bulkOnDemand, laneWakesOnRequest, onDemandJob, authHeaders } = lanes;
  /** A lane's `/healthz` as the sidecar wrote it, or null when the lane is unconfigured or does not answer. */
  async function sidecarHealthz(lane: EmbedLane): Promise<Record<string, unknown> | null> {
    const { endpoint: interactive, bulkEndpoint } = settings();
    const endpoint = lane === "interactive" ? interactive : bulkEndpoint;
    if (!endpoint) return null;
    // An on-demand or wake-on-request lane is never probed (a probe starts it); its space comes with each job.
    if ((lane === "bulk" && bulkOnDemand()) || laneWakesOnRequest(lane)) return null;
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/healthz`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      // swallowed: an unanswered probe is "unknown", which every caller treats as nothing to record.
      return null;
    }
  }

  /** How many tokens each text is, by the bulk sidecar's own tokenizer, nothing cut (`POST /count`). */
  async function remoteTokenCounts(texts: string[]): Promise<number[]> {
    const { bulkEndpoint } = settings();
    if (!bulkEndpoint)
      throw new Error(
        "token counts need an embedding sidecar (LOUVAIN_EMBEDDINGS_BULK_URL or _URL)",
      );
    if (bulkOnDemand()) {
      const out = await onDemandJob(bulkEndpoint, { kind: "count", texts });
      if (!Array.isArray(out.counts) || out.counts.length !== texts.length)
        throw new EmbeddingFailed("embeddings /count: malformed response", "malformed");
      return out.counts as number[];
    }
    const res = await fetch(`${bulkEndpoint.replace(/\/$/, "")}/count`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(settings().timeoutMs),
    });
    if (!res.ok) throw httpFailure("embeddings /count", res.status);
    const data = (await res.json()) as { counts?: number[] };
    if (!Array.isArray(data.counts) || data.counts.length !== texts.length) {
      throw new EmbeddingFailed("embeddings /count: malformed response", "malformed");
    }
    return data.counts;
  }

  /** `wake: true` probes a lane that wakes on request anyway, for a recovery check that wants it started. */
  async function remoteHealth(
    lane: EmbedLane,
    opts: { wake?: boolean } = {},
  ): Promise<{ configured: boolean; ok: boolean; reason?: string; unprobed?: true }> {
    const { endpoint: interactive, bulkEndpoint } = settings();
    const endpoint = lane === "interactive" ? interactive : bulkEndpoint;
    if (!endpoint) return { configured: false, ok: true };
    // Not probed, and not a failure: an on-demand lane answers when a job comes; a cold start is "later".
    if (lane === "bulk" && bulkOnDemand()) return { configured: true, ok: true };
    if (!opts.wake && laneWakesOnRequest(lane))
      return { configured: true, ok: true, unprobed: true };
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, "")}/healthz`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return { configured: true, ok: false, reason: `healthz ${res.status}` };
      // Up is not enough: a sidecar embedding with another model, pooling or width answers every request and puts every
      // vector in the wrong space. That is a degraded search, said out loud, never a silent one.
      const disagreement = sidecarDisagreement(
        (await res.json().catch(() => ({}))) as object,
        settings().model,
      );
      return disagreement
        ? { configured: true, ok: false, reason: disagreement }
        : { configured: true, ok: true };
    } catch (err) {
      return { configured: true, ok: false, reason: String(err) };
    }
  }

  return { sidecarHealthz, remoteTokenCounts, remoteHealth };
}

/** One batch to a lane: a job on an on-demand lane, else `/embed`, with a bulk request that never connected retried. */
function transportOf(c: Client, lanes: Lanes) {
  const { settings, pause } = c;
  const { onDemandJob, authHeaders } = lanes;
  /** The bulk lane on demand: jobs of up to 256 texts (its per-job bound), each a round trip through the queue. */
  async function onDemandEmbed(endpoint: string, texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 256) {
      const batch = texts.slice(offset, offset + 256);
      const out = await onDemandJob(endpoint, { kind: "embed", texts: batch, adapter: null });
      if (out.space && typeof out.space === "object")
        c.lastBulkSpace = out.space as Record<string, unknown>;
      if (!Array.isArray(out.vectors) || out.vectors.length !== batch.length)
        throw new EmbeddingFailed("embeddings: malformed response", "malformed");
      vectors.push(...(out.vectors as number[][]));
    }
    return vectors;
  }

  async function postEmbed(
    lane: EmbedLane,
    url: string,
    init: () => RequestInit,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetch(url, init());
      } catch (err) {
        // A network failure is the fetch standard's TypeError; a timeout is a DOMException and is not retried here.
        const wait = lane === "bulk" ? BULK_RECONNECT_PAUSES_MS[attempt] : undefined;
        if (wait === undefined || !(err instanceof TypeError)) throw err;
        await pause(wait);
      }
    }
  }

  /** One request batch to a sidecar lane: the vectors, with the space the bulk lane states kept for `embeddingSpace`. */
  async function embedBatch(
    lane: EmbedLane,
    endpoint: string,
    batch: string[],
  ): Promise<number[][]> {
    const res = await postEmbed(lane, `${endpoint.replace(/\/$/, "")}/embed`, () => ({
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ texts: batch, lane }),
      signal: AbortSignal.timeout(
        lane === "bulk" ? settings().bulkTimeoutMs : settings().timeoutMs,
      ),
    }));
    if (!res.ok) throw httpFailure("embeddings", res.status);
    const data = (await res.json()) as { vectors?: number[][]; space?: Record<string, unknown> };
    // The space these vectors are in, as the producer stated it; an older Node sidecar states none.
    if (lane === "bulk" && data.space && typeof data.space === "object")
      c.lastBulkSpace = data.space;
    if (!Array.isArray(data.vectors) || data.vectors.length !== batch.length) {
      throw new EmbeddingFailed("embeddings: malformed response", "malformed");
    }
    return data.vectors;
  }

  return { onDemandEmbed, embedBatch };
}

/** The remote client: one per embedder, its settings read on first use. */
export function createRemote(settings: () => RemoteSettings, options: RemoteOptions = {}) {
  const c: Client = {
    settings,
    endpoints: options.endpoints ?? PLAIN_ENDPOINTS,
    pause: options.pause ?? sleep,
    onFailure: options.onFailure,
    warned: false,
    lastBulkSpace: null,
  };
  const lanes = lanesOf(c);
  const { onDemandEmbed, embedBatch } = transportOf(c, lanes);
  const { endpoints } = c;
  const { bulkOnDemand } = lanes;
  /** A failed remote embed is counted and said once per outage; whether it throws follows the fallback policy. */
  function onRemoteFailure(lane: EmbedLane, err: unknown): null {
    try {
      c.onFailure?.({ lane, reason: failureReason(err) });
    } catch {
      // swallowed: counting a failure must never change how the failure is handled.
    }
    if (!c.warned) {
      c.warned = true;
      console.error(
        `embedding service (${lane}) unavailable; ${settings().localFallback ? "falling back in-process" : "request will retry or fail"}: ${String(err)}`,
      );
    }
    if (!settings().localFallback) throw new EmbeddingUnavailable({ cause: err });
    return null;
  }

  /** Unconfigured always means local. Configured failures obey fallback policy. */
  async function remoteEmbed(
    texts: string[],
    lane: EmbedLane = "bulk",
  ): Promise<number[][] | null> {
    const { endpoint: interactive, bulkEndpoint } = settings();
    const named = lane === "interactive" ? interactive : bulkEndpoint;
    if (!named) return null;
    const endpoint = lane === "interactive" ? await endpoints.queryEndpoint(named) : named;
    try {
      if (lane === "bulk" && bulkOnDemand()) return await onDemandEmbed(endpoint, texts);
      const vectors: number[][] = [];
      const requestBatch = settings().requestBatch;
      for (let offset = 0; offset < texts.length; offset += requestBatch) {
        vectors.push(
          ...(await embedBatch(lane, endpoint, texts.slice(offset, offset + requestBatch))),
        );
      }
      c.warned = false;
      return vectors;
    } catch (err) {
      return onRemoteFailure(lane, err);
    }
  }

  return {
    ...lanes,
    ...probesOf(c, lanes),
    remoteEmbed,
    /** The embedding space the bulk lane's most recent response stated, if it states one. */
    lastStatedBulkSpace: (): Record<string, unknown> | null => c.lastBulkSpace,
  };
}

export type RemoteClient = ReturnType<typeof createRemote>;
