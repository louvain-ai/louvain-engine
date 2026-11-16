import { mayBePooled } from "./pooler.js";

/** The plan cache mode for the pool (`db-settings.ts`): a setting, a scope, and the policy decided from them and the URL. */
const PLAN_CACHE_MODES = ["auto", "force_custom_plan", "force_generic_plan"] as const;
export type PlanCacheMode = (typeof PLAN_CACHE_MODES)[number];
export const DEFAULT_PLAN_CACHE_MODE: PlanCacheMode = "force_custom_plan";
const PLAN_CACHE_SCOPES = ["reads", "connection"] as const;
export type PlanCacheScope = (typeof PLAN_CACHE_SCOPES)[number];
export const DEFAULT_PLAN_CACHE_SCOPE: PlanCacheScope = "reads";

/**
 * `LOUVAIN_DB_PLAN_CACHE_MODE`: one of Postgres's three values, or `off` to send
 * and set nothing (the server's or the role's own default decides). BLANK IS
 * ABSENT, as everywhere in `config.ts`: compose writes an unset optional as "",
 * and a blank that switched the fix off would do it on every compose deployment
 * that forwards the variable. An unknown value is the default, with one line.
 */
export function planCacheModeSetting(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
  name = "LOUVAIN_DB_PLAN_CACHE_MODE",
): PlanCacheMode | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return DEFAULT_PLAN_CACHE_MODE;
  if (value === "off") return null;
  const known = PLAN_CACHE_MODES.find((mode) => mode === value);
  if (known) return known;
  warn(
    `config: ${name}=${JSON.stringify(raw)} is not one of ${[...PLAN_CACHE_MODES, "off"].join(", ")}; using ${DEFAULT_PLAN_CACHE_MODE}`,
  );
  return DEFAULT_PLAN_CACHE_MODE;
}

/**
 * `LOUVAIN_DB_PLAN_CACHE_SCOPE`: `reads` (bounded reads only, the default) or
 * `connection` (at connect as well, where no pooler can refuse it). Blank is
 * absent; an unknown value is the default, with one line.
 */
export function planCacheScopeSetting(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
  name = "LOUVAIN_DB_PLAN_CACHE_SCOPE",
): PlanCacheScope {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return DEFAULT_PLAN_CACHE_SCOPE;
  const known = PLAN_CACHE_SCOPES.find((scope) => scope === value);
  if (known) return known;
  warn(
    `config: ${name}=${JSON.stringify(raw)} is not one of ${PLAN_CACHE_SCOPES.join(", ")}; using ${DEFAULT_PLAN_CACHE_SCOPE}`,
  );
  return DEFAULT_PLAN_CACHE_SCOPE;
}

export type PlanCachePolicy = {
  /** Sent in every connection's startup packet (postgres.js `connection`), or null. */
  startup: PlanCacheMode | null;
  /** `set local` at the start of every bounded read, or null. */
  perTransaction: PlanCacheMode | null;
  /** What was decided and why, for the boot log. No URL, no credential. */
  summary: string;
};

/** The rule above, pure, so it is tested rather than assumed. */
export function planCachePolicy(input: {
  prepare: boolean;
  mode: PlanCacheMode | null;
  scope: PlanCacheScope;
  url: string;
}): PlanCachePolicy {
  if (!input.prepare)
    return unset(
      "plan_cache_mode not set, prepared statements are off (LOUVAIN_DB_PREPARE=false), so every statement is planned for its own parameters",
    );
  if (input.mode === null)
    return unset(
      "plan_cache_mode not set (LOUVAIN_DB_PLAN_CACHE_MODE=off), so a prepared statement may switch to a generic plan after five executions on a connection",
    );
  if (input.scope === "reads")
    return readsOnly(
      input.mode,
      `plan_cache_mode=${input.mode} inside bounded reads only (LOUVAIN_DB_PLAN_CACHE_SCOPE=reads); every other statement keeps Postgres's plan cache`,
    );
  if (mayBePooled(input.url))
    return readsOnly(
      input.mode,
      `plan_cache_mode=${input.mode} inside bounded reads only — LOUVAIN_DB_PLAN_CACHE_SCOPE=connection, but DATABASE_URL looks pooled, and a pooler refuses a startup parameter it does not track`,
    );
  return {
    startup: input.mode,
    perTransaction: input.mode,
    summary: `plan_cache_mode=${input.mode} on every connection (prepared statements on, direct endpoint)`,
  };
}

const unset = (summary: string): PlanCachePolicy => ({
  startup: null,
  perTransaction: null,
  summary,
});
const readsOnly = (mode: PlanCacheMode, summary: string): PlanCachePolicy => ({
  startup: null,
  perTransaction: mode,
  summary,
});
