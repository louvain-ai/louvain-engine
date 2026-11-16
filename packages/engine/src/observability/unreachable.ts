import { EmbeddingUnavailable } from "@louvain/embeddings";

/**
 * Whether a failure is a service that could not be reached, not work that was wrong: an embedding sidecar that could not
 * answer (`EmbeddingUnavailable`, anywhere in the error's causes), or a socket that could not connect. A stage runner
 * and a queue's failure policy read the same answer, so a record read while a lane was down is retried, not
 * dead-lettered.
 */
export function isUnreachable(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause)
    if (e instanceof EmbeddingUnavailable) return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(
    String(err),
  );
}
