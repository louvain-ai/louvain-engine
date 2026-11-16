import { AsyncLocalStorage } from "node:async_hooks";
import { stage as timedStage } from "../observability/stage.js";
import type { Tags } from "../observability/telemetry.js";
import { DeadlineError } from "./ask-settings.js";
import { askContext } from "./question.js";

/**
 * The timeout for one model call: the caller's own ceiling, cut to whatever
 * the question has left. Outside a context the ceiling stands alone.
 */
export function callTimeoutMs(ceilingMs: number): number {
  const ctx = askContext();
  if (!ctx) return ceilingMs;
  return Math.max(1, Math.min(ceilingMs, ctx.remaining()));
}

/**
 * The signal for one model call: its timeout (`callTimeoutMs`), and — inside a
 * question whose asker can leave — the question's own abort. A call in flight
 * when the client disconnects is cancelled there and then, not left to run to
 * its timeout and bill for tokens nobody receives.
 */
export function callSignal(ceilingMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(callTimeoutMs(ceilingMs));
  const asker = askContext()?.signal ?? abortScope.getStore();
  return asker ? AbortSignal.any([timeout, asker]) : timeout;
}

/**
 * A stage of the answer, timed under its own name and recorded on the question's context; outside one, only timed.
 * `tags` are read when the stage settles, so a lane may note how it went on the object it passed, and a lane whose
 * failure is a designed degradation settles normally under its tag: `stage` reports only a throw the caller does not
 * survive.
 */
export function stage<T>(name: string, fn: () => Promise<T>, tags: Tags = {}): Promise<T> {
  const ctx = askContext();
  const key = name.replace(/^(ask|read|search)\./, "");
  return timedStage(name, fn, {
    tags,
    done: (ms) => {
      if (ctx) ctx.timings[key] = Math.round(((ctx.timings[key] ?? 0) + ms / 1000) * 1000) / 1000;
    },
  });
}

/**
 * A model call whose spent budget is the lane's designed degradation, for `stage`'s `fn`. A `DeadlineError` comes
 * back as a value inside the stage, which settles under `deadline: "spent"` and reports no error: a spent budget is
 * counted (`ask.deadline`), and an error per lane per refusal would bury the reader failures worth reporting. Any
 * other throw passes through to `stage`.
 */
export function spendable<T>(fn: () => Promise<T>, tags: Tags): () => Promise<T | DeadlineError> {
  return async () => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof DeadlineError)) throw err;
      tags.deadline = "spent";
      return err;
    }
  };
}

/** Cancellation alone, for a caller that has no answer budget of its own. */
const abortScope = new AsyncLocalStorage<AbortSignal>();

export function withAskAbort<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return signal ? abortScope.run(signal, fn) : fn();
}
