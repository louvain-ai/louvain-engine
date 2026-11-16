import type { Logger } from "./logging.js";
import type { Telemetry } from "./telemetry.js";

/** How many frames of a stack a line keeps: enough to find the throw, not a page of the runtime's own. */
const STACK_FRAMES = 12;

/**
 * The sink when none is given: each error as one line on `logger`, at `error`, naming the operation that failed, its
 * tags and the exception's class, message and first frames. The logger scrubs the message and every string field
 * (`scrub.ts`): quoted values, a driver's `Key()=()`, the operand after `: `, addresses and ids are removed, so what a
 * failing statement held never reaches the line. Counts, timings and levels go nowhere: a log is not a metrics store.
 */
export function errorsToLog(logger: Logger): Telemetry {
  return {
    count: () => {},
    timing: () => {},
    error: (name, err, tags) => {
      const e = err instanceof Error ? err : null;
      logger.error(`${name} failed`, {
        component: name,
        error: e ? `${e.name}: ${e.message}` : String(err),
        ...(e?.stack
          ? {
              stack: e.stack
                .split("\n")
                .slice(1, 1 + STACK_FRAMES)
                .join("\n"),
            }
          : {}),
        ...tags,
      });
    },
  };
}
