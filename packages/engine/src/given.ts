/**
 * What a read's context and a write's writes are given beside their hooks, as their engine was (`createEngine`): the
 * telemetry its counts go to and the logger its lines go to, each asked through one accessor (`telemetryOf`, `logOf`).
 */

import { guarded } from "./guarded.js";
import { type Logger, log } from "./observability/logging.js";
import type { Telemetry } from "./telemetry.js";

/** What reports nowhere: a read or a write no engine made. */
const nowhere = guarded(() => undefined);

/** The telemetry a read's context or a write's writes carry, the part their engine was given. */
export type Told = { readonly telemetry?: Required<Telemetry> };

/** Its engine's telemetry; a read or a write no engine made reports nowhere. */
export const telemetryOf = (on: { readonly hooks?: Told | undefined }): Required<Telemetry> =>
  on.hooks?.telemetry ?? nowhere;

/** The logger a read's context or a write's writes carry, the part their engine was given. */
export type Logged = { readonly logger?: Logger };

/** Its engine's logger; a read or a write no engine made writes to the process's (`log`). */
export const logOf = (on: { readonly hooks?: Logged | undefined }): Logger =>
  on.hooks?.logger ?? log;
