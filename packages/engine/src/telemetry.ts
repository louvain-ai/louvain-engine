/**
 * The observability seam. The engine carries no vendor SDK (each is a dependency, a configuration surface and a
 * decision about where data goes), so the default sink is a no-op and a deployment registers its own at boot. Telemetry
 * never carries indexed text: tags are ids, operation names and outcomes, never a question or a passage, because a
 * reader who cannot see a collection must not see it in a dashboard either.
 */

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

const noop: Telemetry = {
  count: () => {},
  timing: () => {},
  error: () => {},
};

let sink: Telemetry = noop;
let registered: string | null = null;

/** Register a telemetry sink. Last one wins; the name is reported on /healthz. */
export function registerTelemetry(name: string, t: Telemetry): void {
  sink = t;
  registered = name;
}

export function telemetryName(): string | null {
  return registered;
}

/**
 * Every call is wrapped so a broken sink cannot break the request that emitted
 * it. Observability failing loudly inside a handler would make the monitoring
 * the outage — the exact inversion it exists to prevent.
 */
export const telemetry: Required<Telemetry> = {
  count(name, n, tags) {
    try {
      sink.count(name, n, tags);
    } catch {
      /* a metric is never worth a request */
    }
  },
  timing(name, ms, tags) {
    try {
      sink.timing(name, ms, tags);
    } catch {
      /* as above */
    }
  },
  gauge(name, value, tags) {
    try {
      sink.gauge?.(name, value, tags);
    } catch {
      // swallowed: a level is never worth a request
    }
  },
  error(name, err, tags) {
    try {
      sink.error(name, err, tags);
    } catch {
      /* as above */
    }
  },
};
