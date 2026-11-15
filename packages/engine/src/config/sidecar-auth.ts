import { environment } from "./environment.js";

/**
 * The bearer every call to one of the engine's own sidecars carries. A private network is not an authentication, so
 * with `LOUVAIN_SIDECAR_TOKEN` set each sidecar refuses a request without it. Never sent to anything else: a
 * third-party reranker has its own key, and this token opens every sidecar. Read on every call, so no test resets a memo.
 */
export function sidecarAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = environment("LOUVAIN_SIDECAR_TOKEN", env);
  return token ? { authorization: `Bearer ${token}` } : {};
}
