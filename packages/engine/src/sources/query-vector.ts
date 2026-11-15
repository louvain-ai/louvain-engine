import { createHash } from "node:crypto";
import { EMBEDDING_DIM } from "@louvain/embeddings";
import { withDeadline } from "@louvain/engine-core";
import { LRUCache } from "lru-cache";
import { embedQuery } from "../embedder.js";

// Bounded, short-lived query vectors only. Never cache source IDs, excerpts or ACL decisions.
// `lru-cache`: 64 queries for a minute; a vector that came back empty is forgotten at once.
const cache = new LRUCache<string, Promise<number[] | null>>({ max: 64, ttl: 60_000 });
let pending = 0;
export async function sourceQueryVector(query: string): Promise<number[] | null> {
  const key = createHash("sha256").update(query).digest("hex");
  let entry = cache.get(key);
  if (!entry) {
    if (pending >= 4) return null;
    pending++;
    const vector = embedQuery(query)
      .then((v) => (v.length === EMBEDDING_DIM && v.every(Number.isFinite) ? v : null))
      .catch(() => null)
      .finally(() => {
        pending--;
      });
    entry = vector;
    cache.set(key, vector);
    void vector.then((value) => {
      // Only THIS promise: a newer one cached since stays.
      if (!value && cache.get(key) === vector) cache.delete(key);
    });
  }
  // The vector is shared (cached for every caller of the same query), so it is never aborted: only this wait ends.
  const shared = entry;
  return await withDeadline(() => shared, 2500, { onTimeout: () => null });
}
