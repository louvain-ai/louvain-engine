import { type Embedder, toPgVector } from "@louvain/embeddings";
import { LRUCache } from "lru-cache";

/** What a recent vector is keyed by: the loader that embeds it, the workspace and the words. */
export type RecentKey = { loader: object; orgId: string | undefined; text: string };

/**
 * One embedding per distinct text, within a workspace, for a minute. Legs started together for the same words share the
 * in-flight promise, and a page asked again within the minute embeds nothing. Keyed by the loader, the workspace and
 * the words: shared across workspaces, a hit's speed would tell one workspace that another just searched a phrase.
 * Bounded (64 texts per loader, 60 s); it holds a vector only, never an id, an excerpt or a readable set. A failure or
 * an empty vector is forgotten at once, and a fallback is the caller's (`space.ts` `queryIn`), never cached here.
 */
const recentByLoader = new WeakMap<object, LRUCache<string, Promise<string>>>();

export function recentVector(
  { loader, orgId, text }: RecentKey,
  embed: () => Promise<string>,
): Promise<string> {
  // A read that does not say its workspace embeds afresh.
  if (!orgId) return embed();
  const key = `${orgId}\u0000${text}`;
  let recent = recentByLoader.get(loader);
  if (!recent) {
    recent = new LRUCache<string, Promise<string>>({ max: 64, ttl: 60_000 });
    recentByLoader.set(loader, recent);
  }
  const kept = recent.get(key);
  if (kept) return kept;
  const vector = embed();
  recent.set(key, vector);
  vector.then(
    // An empty vector is no vector: not kept, as `sources/query-vector.ts` forgets one.
    (v) => {
      if (v === "[]" && recent.peek(key) === vector) recent.delete(key);
    },
    () => {
      // swallowed: every caller awaits this same promise and handles the failure itself; this only forgets it (and only
      // this promise: a newer one cached since stays), so the next call asks the sidecar again.
      if (recent.peek(key) === vector) recent.delete(key);
    },
  );
  return vector;
}

/** Forget one loader's shared query vectors (tests; a sidecar swapped under a running process). */
export function forgetRecentQueryVectors(loader: object): void {
  recentByLoader.delete(loader);
}

/**
 * An embedder's query embedding, as a pgvector literal: its interactive lane, timed as `ask.embed`. One function per
 * embedder, so every memo keyed by its loader (`recent-vectors.ts`, `queryVectorWith`) is keyed by the embedder and a
 * vector from one never stands in for another's.
 */
const queryLoaders = new WeakMap<Embedder, (text: string) => Promise<string>>();
export function queryLoader(embedder: Embedder): (text: string) => Promise<string> {
  let load = queryLoaders.get(embedder);
  if (!load) {
    load = async (text) => toPgVector(await embedder.embedQuery(text));
    queryLoaders.set(embedder, load);
  }
  return load;
}
