import { mayBePooled } from "./pooler.js";

/** JIT for the pool: off for the process unless asked (`config/engine.ts`), sent at connect where no pooler can refuse it. */
const JIT_SETTINGS = ["off", "server"] as const;
export type JitSetting = (typeof JIT_SETTINGS)[number];

/**
 * `LOUVAIN_DB_JIT`: `off` (default) — the app's connections never JIT-compile; `server` — send nothing and leave it
 * to the server's or the role's setting (a deployment that found a gain). Blank is absent; an unknown value is the
 * default, with one line. Bounded reads set `jit = off` either way.
 */
export function jitSetting(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
  name = "LOUVAIN_DB_JIT",
): JitSetting {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return "off";
  const known = JIT_SETTINGS.find((s) => s === value);
  if (known) return known;
  warn(
    `config: ${name}=${JSON.stringify(raw)} is not one of ${JIT_SETTINGS.join(", ")}; using off`,
  );
  return "off";
}

export type JitPolicy = {
  /** `jit = off` in every connection's startup packet. */
  startup: boolean;
  /** What was decided and why, for the boot log. No URL, no credential. */
  summary: string;
};

/** Where `jit = off` can go for this URL: the startup packet unless a pooler may refuse it. Pure, so it is tested. */
export function jitPolicy(input: { setting: JitSetting; url: string }): JitPolicy {
  if (input.setting === "server")
    return {
      startup: false,
      summary: "jit left to the server (LOUVAIN_DB_JIT=server); bounded reads still set jit=off",
    };
  if (mayBePooled(input.url))
    return {
      startup: false,
      summary:
        "jit=off inside bounded reads only — DATABASE_URL may be a pooler, which refuses a startup parameter it does not track",
    };
  return { startup: true, summary: "jit=off on every connection" };
}
