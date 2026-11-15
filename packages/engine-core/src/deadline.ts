/**
 * Work with a deadline, one definition. Eight copies raced a promise against a `setTimeout`: each
 * remembered to clear its timer or did not (the miner's never did, so every run held a live timer for its whole
 * budget), and none could STOP the work it gave up on — the loser of `Promise.race` runs on. So:
 *
 * - The work is handed an `AbortSignal` that fires at the deadline (or when a `parent` signal does: an answer's one
 *   deadline). Work that takes a signal stops; work that cannot is left to finish, and a failure it meets after
 *   the deadline goes to `late`, never to an unhandled rejection.
 * - At the deadline the caller gets `onTimeout()`'s value when it gave one (a fallback: `null`, "slow", "skip"), and a
 *   `DeadlineExceeded` otherwise.
 * - The deadline is a timer the process WAITS ON while the caller does (`AbortSignal.timeout`'s does not: a test whose
 *   work never settled exited before its deadline), cleared the moment either side wins, so none outlives the call.
 */

export class DeadlineExceeded extends Error {
  override name = "DeadlineExceeded";
  constructor(readonly ms: number) {
    super(`no answer in ${ms} ms`);
  }
}
type Options<F> = {
  /** Aborting this aborts the work too, whichever comes first. */
  parent?: AbortSignal | undefined;
  /** The value at the deadline, instead of a `DeadlineExceeded`. */
  onTimeout?: () => F;
  /** A failure the work meets after the deadline, when nobody awaits it any more. */
  late?: (error: unknown) => void;
};
export function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  options?: Omit<Options<never>, "onTimeout">,
): Promise<T>;
export function withDeadline<T, F>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  options: Options<F> & { onTimeout: () => F },
): Promise<T | F>;
export async function withDeadline<T, F>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  options: Options<F> = {},
): Promise<T | F> {
  const clock = new AbortController();
  const timer = setTimeout(() => clock.abort(new DeadlineExceeded(ms)), Math.max(0, ms));
  const timeout = clock.signal;
  const signal = options.parent ? AbortSignal.any([timeout, options.parent]) : timeout;
  const running = Promise.resolve().then(() => work(signal));
  let onAbort: (() => void) | undefined;
  const expired = new Promise<"expired">((resolve) => {
    if (signal.aborted) resolve("expired");
    else {
      onAbort = () => resolve("expired");
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    const first = await Promise.race([running.then((value) => ({ value })), expired]);
    if (first !== "expired") return first.value;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  running.catch((error: unknown) => {
    // swallowed: nobody awaits the work after its deadline; `late` is the caller's report of what it met.
    options.late?.(error);
  });
  if (options.onTimeout) return options.onTimeout();
  // A parent that aborted first says why; our own clock says how long it waited.
  if (options.parent?.aborted && !timeout.aborted) throw options.parent.reason;
  throw new DeadlineExceeded(ms);
}
