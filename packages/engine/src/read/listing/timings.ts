import { AsyncLocalStorage } from "node:async_hooks";
import { stage } from "../../observability/stage.js";

/**
 * Time one phase of a source search on the shared stage series (`pipeline: "sources"`), through the one `stage`:
 * bounded names, never data. A failure is the caller's to report; the phase's milliseconds also go to the request's
 * own store when one is open (`searchTimings`).
 */
export const timed = <T>(name: string, run: () => Promise<T>): Promise<T> =>
  stage("pipeline.stage", run, {
    tags: { pipeline: "sources", stage: name },
    report: false,
    done: (ms) => {
      const mine = searchTimings.getStore();
      if (mine) mine.set(name, (mine.get(name) ?? 0) + ms);
    },
  });

/**
 * One request's stages, for its own `Server-Timing` (`routes.ts`): the same stage names and milliseconds the shared
 * series counts, collected only inside `withSearchTimings`, so a browser can see where its own search went. Names and
 * numbers only: no query, no id, nothing a reader wrote.
 */
export const searchTimings = new AsyncLocalStorage<Map<string, number>>();
