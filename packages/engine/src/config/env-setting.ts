/**
 * A number from the environment, read safely, for a module that sets a constant at import (a recall tuning knob):
 * `Number(process.env.X ?? d)` turns a blank value into 0 and a typo into NaN. Unset or blank is the fallback; anything
 * that is not a number in range warns once and is the fallback; an explicit value `min` allows stands (0 included,
 * where 0 is meant). The engine reads the environment here, at its edge: the core reads none.
 */
export function envSetting(name: string, fallback: number, opts: NumberBounds = {}): number {
  return numberIn(
    name,
    typeof process === "undefined" ? undefined : process.env[name],
    fallback,
    opts,
  );
}

/** The bounds a number setting is held to: at least `min` (0), at most `max`, whole unless `integer` is false. */
export type NumberBounds = { min?: number; max?: number; integer?: boolean };

/** `envSetting`'s rule for one value already read, so a declared setting (`settings.ts`) parses it the same way. */
export function numberIn(
  name: string,
  raw: string | undefined,
  fallback: number,
  opts: NumberBounds = {},
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = opts;
  const n = Number(raw.trim());
  if (Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= min && n <= max) return n;
  console.warn(
    `config: ${name}=${JSON.stringify(raw)} is not ${integer ? "an integer" : "a number"} between ${min} and ${max}; using ${fallback}`,
  );
  return fallback;
}
