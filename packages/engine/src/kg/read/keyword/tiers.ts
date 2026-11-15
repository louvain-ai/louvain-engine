import { sidecarAuthHeaders } from "../../../config/sidecar-auth.js";
import { sayOnce } from "../../../observability/logging.js";
import { bm25Settings } from "../bm25.js";
import type { Bm25Narrowing } from "./rows.js";

/**
 * THE KEYWORD INDEX'S TIERS (`apps/nlp/bm25_last.py` `search_last`, `strategy: "last"`): Meilisearch's matching strategy
 * under the reader's fence. Every word of the search first, then the words less the last, each tier ranked by its own
 * BM25. A word no readable document holds is asked as a clause of the same query (the term suggester's
 * `suggest_mode: missing` gate): the last word as a prefix and, unless it is a key, a typo; any other word as a typo
 * within Meilisearch's word sizes; a word that finds nothing readable even so is left out. The answer names those
 * words, never the terms they matched, and `asked`, how many words the first tier asked for: a hit whose `words` is
 * `asked` holds every word searched.
 */
/** A tier's hit; its snippet, the fragment where the search's words fell (none: its words are not in its text). */
export type TierHit = {
  id: string;
  score: number;
  words: number;
  snippet?: { text: string; marks: [number, number][] } | null;
};
export type Tiers = {
  hits: TierHit[];
  asked: number;
  completed: string[];
  corrected: string[];
  dropped: string[];
};

/** One tiered `/search`, fenced by `containers` (already the reader's), narrowed only by what `narrow` names. */
export async function bm25Tiers(args: {
  orgId: string;
  containers: readonly string[];
  query: string;
  limit: number;
  asOf?: string | undefined;
  narrow?: Bm25Narrowing & { ids?: readonly string[] };
}): Promise<Tiers> {
  const { endpoint, timeoutMs } = bm25Settings();
  if (!endpoint) throw new Error("bm25 tiers: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({
      org: args.orgId,
      containers: args.containers,
      query: args.query,
      limit: args.limit,
      strategy: "last",
      ...(args.asOf ? { asOf: args.asOf } : {}),
      ...args.narrow,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 tiers ${res.status}`);
  const data = (await res.json()) as Partial<Tiers>;
  if (!Array.isArray(data.hits) || typeof data.asked !== "number") {
    sayOnce("the keyword index is older than this engine; run ./engine up");
    throw new Error("bm25 tiers: an index older than this engine answered without tiers");
  }
  return {
    hits: data.hits,
    asked: data.asked,
    completed: data.completed ?? [],
    corrected: data.corrected ?? [],
    dropped: data.dropped ?? [],
  };
}

/** The hits that hold every word searched: the first tier's. */
export const holdingEvery = (tiers: Tiers): TierHit[] =>
  tiers.asked > 0 ? tiers.hits.filter((h) => h.words === tiers.asked) : [];
