import { type Tags, telemetry } from "./telemetry.js";

/**
 * How a stage is recorded: the tags its timing carries beside its outcome, whether a throw is reported (`report`,
 * false where the caller counts its own failure), and `done`, told the milliseconds and the outcome once it settles.
 */
export type StageOptions = {
  tags?: Tags;
  report?: boolean;
  done?: (ms: number, ok: boolean) => void;
};

/**
 * One step, timed under its bounded name whichever way it ends (`outcome`: ok or error), through the telemetry seam:
 * a host that keeps metrics records it, and unbound nothing is kept. What it throws is reported once and thrown on.
 * The name and the tags are bounded names the caller declares, never data.
 */
export async function stage<T>(
  name: string,
  run: () => Promise<T>,
  { tags = {}, report = true, done }: StageOptions = {},
): Promise<T> {
  const started = performance.now();
  let ok = false;
  try {
    const value = await run();
    ok = true;
    return value;
  } catch (err) {
    if (report) telemetry.error(name, err, tags);
    throw err;
  } finally {
    const ms = performance.now() - started;
    telemetry.timing(name, ms, { ...tags, outcome: ok ? "ok" : "error" });
    done?.(ms, ok);
  }
}
