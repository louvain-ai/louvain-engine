import { stage as timedStage } from "../observability/stage.js";

/** What a stage hands on: its value, and what it could not do, by bounded name (`degraded`). */
export type Staged<T> = { value: T; degraded: readonly string[] };

/** The stages a search runs, by the bounded names they are timed under (`search.<name>`). */
type StageName =
  | "legs"
  | "passages"
  | "titled"
  | "documents"
  | "originals"
  | "named"
  | "conversation";

/** One named stage of a search, timed; what it degraded is returned with its value, never pushed. */
export const stage = <T>(name: StageName, run: () => Promise<Staged<T>>): Promise<Staged<T>> =>
  timedStage(`search.${name}`, run);

/** A stage that cannot degrade. */
export const whole = async <T>(value: Promise<T>): Promise<Staged<T>> => ({
  value: await value,
  degraded: [],
});
