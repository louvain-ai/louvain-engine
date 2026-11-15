/**
 * An ingest's stages, each timed under its own bounded name (`ingest.<stage>`, labelled with its outcome and nothing
 * else). A critical stage's failure is its caller's; a best-effort stage's failure costs only what that stage adds.
 */
import { durableWork } from "../memory/work-seam.js";
import { stage as timedStage } from "../observability/stage.js";

/** One stage, timed whichever way it ends; what it throws is thrown on, and counted by its caller, not reported. */
export const stage = <T>(name: StageName, run: () => Promise<T>): Promise<T> =>
  timedStage(name, run, { report: false });

/** The stages, by the names they are timed under. */
export type StageName = `ingest.${
  | "read"
  | "accept"
  | "record"
  | "cut"
  | "embed"
  | "write"
  | "contexts"
  | "keyword"
  | "retire"}`;

/** What a best-effort stage hands on: its value, or that it could not run. */
export type Effort<T> = { value: T; degraded: false } | { value: undefined; degraded: true };

/**
 * A stage whose failure costs only what it adds: `missed` counts the failure and the record stands without it, until
 * its next index adds it. Under a durable owner the failure is thrown on, so the owner retries and what it adds lands.
 */
export async function bestEffort<T>(
  name: StageName,
  run: () => Promise<T>,
  missed: (err: unknown) => void,
): Promise<Effort<T>> {
  try {
    return { value: await stage(name, run), degraded: false };
  } catch (err) {
    missed(err);
    if (durableWork()) throw err;
    // swallowed: counted by `missed`; the record's next index adds what this stage would have.
    return { value: undefined, degraded: true };
  }
}
