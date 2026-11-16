import type { Telemetry } from "./telemetry.js";

/**
 * The sink `current` returns (none: nothing), every call wrapped so a broken sink cannot break the request that emitted it.
 * Observability failing loudly inside a handler would make the monitoring the outage — the exact inversion it exists
 * to prevent.
 */
export function guarded(current: () => Telemetry | undefined): Required<Telemetry> {
  return {
    count(name, n, tags) {
      try {
        current()?.count(name, n, tags);
      } catch {
        /* a metric is never worth a request */
      }
    },
    timing(name, ms, tags) {
      try {
        current()?.timing(name, ms, tags);
      } catch {
        /* as above */
      }
    },
    gauge(name, value, tags) {
      try {
        current()?.gauge?.(name, value, tags);
      } catch {
        // swallowed: a level is never worth a request
      }
    },
    error(name, err, tags) {
      try {
        current()?.error(name, err, tags);
      } catch {
        /* as above */
      }
    },
  };
}
