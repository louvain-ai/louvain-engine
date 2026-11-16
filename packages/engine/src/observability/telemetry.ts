/**
 * The observability seam. The engine carries no vendor SDK (each is a dependency, a configuration surface and a
 * decision about where data goes), so an engine is given its sink as a part (`EngineParts.telemetry`), and the door
 * below takes the one a deployment registers at boot. With none given or registered, errors still go somewhere: to the
 * logger (`errorsToLog`), as one scrubbed line each, so a route that throws leaves its stack in the server's log rather
 * than nothing; counts and timings need a sink. Telemetry never carries indexed text: tags are ids, operation names and
 * outcomes, never a question or a passage, because a reader who cannot see a collection must not see it in a dashboard
 * either.
 */

import { errorsToLog } from "./errors-to-log.js";
import { guarded } from "./guarded.js";
import { openLogger } from "./logging.js";

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

/** Register the door's telemetry sink. Last one wins; `telemetryName` says which, for a deployment's own health check. */
export function registerTelemetry(name: string, t: Telemetry): void {
  sink = t;
  registered = name;
}

export function telemetryName(): string | null {
  return registered;
}

/** Where the door reports an error when no sink is registered: the process's log. */
const toProcessLog: Readonly<Telemetry> = errorsToLog(openLogger());

/** The door: whatever sink is registered, guarded; with none, its errors to the process's log. */
export const telemetry: Required<Telemetry> = guarded(() => sink ?? toProcessLog);
