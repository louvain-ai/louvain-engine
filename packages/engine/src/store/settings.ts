/**
 * How the pool's connections plan a prepared statement. A generic plan cannot fold an optional filter, so every bounded
 * read sets `plan_cache_mode` with `set local`, which reaches the right backend through any pooler. The startup
 * parameter, which a pooler may refuse, is sent only where the address does not look pooled; a session `set` never.
 * JIT is off for the process: an estimate is not a runtime, and a short read can pay more to compile than to run.
 */
export { type JitPolicy, jitPolicy, jitSetting } from "./jit.js";
export {
  DEFAULT_PLAN_CACHE_MODE,
  DEFAULT_PLAN_CACHE_SCOPE,
  type PlanCachePolicy,
  planCacheModeSetting,
  planCachePolicy,
  planCacheScopeSetting,
} from "./plan-cache.js";
export { looksPooled, mayBePooled } from "./pooler.js";
