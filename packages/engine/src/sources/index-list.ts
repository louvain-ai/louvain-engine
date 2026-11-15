import { sidecarAuthHeaders } from "../config/sidecar-auth.js";
import { bm25Settings } from "../kg/read/bm25.js";
import { documentEntryId, documentOfEntry } from "./keyword-documents.js";
import type { Scope } from "./read-core.js";

/** A listed entry's snippet (`apps/nlp/bm25.py` `_snippet`): the fragment where the search's words fell. */
type Snippet = { text: string; marks: [number, number][] } | null;

/**
 * What the index's `/list` answers: a page of entry ids, each one's snippet (a listing with words), the total, and the
 * facets by app and collection.
 */
export type Listed = {
  ids: string[];
  snippets?: Snippet[];
  total: number;
  facets: { app: string; container: string; count: number }[];
  facetsBounded?: boolean;
};

/**
 * The readable documents the index lists for these words, best first, at most `limit` (the index's own cap, 200):
 * document ids, under the scope's fence, for a read that decides by its own rule which of them it keeps.
 */
export async function documentsListedFor(
  s: Scope,
  query: string,
  limit: number,
): Promise<string[]> {
  const listed = await postList({
    org: s.orgId,
    containers: s.containers,
    query,
    order: "relevance",
    offset: 0,
    limit,
    ...(s.reach ? { ids: s.reach.map(documentEntryId) } : {}),
  });
  return listed.ids.map(documentOfEntry);
}

/** One `/list` call (`apps/nlp/bm25.py` `listing`), the body as the caller built it. */
export async function postList(body: Record<string, unknown>): Promise<Listed> {
  const { endpoint, timeoutMs } = bm25Settings();
  if (!endpoint) throw new Error("index listing: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/list`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`index listing ${res.status}`);
  return (await res.json()) as Listed;
}

/**
 * The key each text opens with, in the keyword index's own analyzed form (`apps/nlp/analyzer.py` `lead`: a key's parts
 * joined, after at most one bracket), or null where it opens with none. Keys are compared in that one form, never in a
 * second implementation of the analyzer's step. No document is read.
 */
export async function bm25Leads(texts: readonly string[]): Promise<(string | null)[]> {
  const { endpoint, timeoutMs } = bm25Settings();
  if (!endpoint) throw new Error("bm25 keys: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 keys ${res.status}`);
  const data = (await res.json()) as { leads?: unknown };
  if (!Array.isArray(data.leads) || data.leads.length !== texts.length)
    throw new Error("bm25 keys: malformed response");
  return data.leads as (string | null)[];
}
