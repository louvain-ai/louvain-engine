import { telemetry } from "../observability/telemetry.js";

/** What a step that may fail hands back: its value, or the fallback and the name of what it could not do. */
export type Attempted<T> = { value: T; degraded: string[] };

/**
 * A leg that fails costs its rows and says so in what it returns, never the question: its value, or `fallback` and
 * `[what]`. The failure is reported once.
 */
export const attempt = async <T>(
  what: string,
  fallback: T,
  work: () => Promise<T>,
): Promise<Attempted<T>> => {
  try {
    return { value: await work(), degraded: [] };
  } catch (err) {
    // A leg that failed costs its rows, never the question: the other legs may hold the answer.
    telemetry.error("ask.leg", err);
    return { value: fallback, degraded: [what] };
  }
};
