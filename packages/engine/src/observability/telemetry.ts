/**
 * The observability seam. The engine carries no vendor SDK (each is a dependency, a configuration surface and a
 * decision about where data goes), so an engine is given its sink as a part (`EngineParts.telemetry`, a no-op unless
 * given), and the door below takes the one a deployment registers at boot. Telemetry
 * never carries indexed text: tags are ids, operation names and outcomes, never a question or a passage, because a
 * reader who cannot see a collection must not see it in a dashboard either.
 */
import { guarded } from "./guarded.js";

export type Tags = Record<string, string | number>;

export type Telemetry = {
  /** A thing happened, n times. */
  count(name: string, n: number, tags?: Tags): void;
  /** A thing took this long. */
  timing(name: string, ms: number, tags?: Tags): void;
  /** A level, as it stands now (a pool's occupancy); a sink that keeps no levels leaves it out. */
  gauge?(name: string, value: number, tags?: Tags): void;
  /** A thing failed. `err` is whatever was thrown. */
  error(name: string, err: unknown, tags?: Tags): void;
};

/**
 * The door's sink, for the call sites with no engine in reach (`check-engine-state.mjs` lists them, and the list only
 * shrinks); an engine's own is the part it was given (`EngineParts.telemetry`, `given.ts` `telemetryOf`).
 */
let sink: Telemetry | undefined;

let registered: string | null = null;

/** Register the door's telemetry sink. Last one wins; the name is reported on /healthz. */
export function registerTelemetry(name: string, t: Telemetry): void {
  sink = t;
  registered = name;
}

export function telemetryName(): string | null {
  return registered;
}

/** The door: whatever sink is registered, guarded. */
export const telemetry: Required<Telemetry> = guarded(() => sink);
