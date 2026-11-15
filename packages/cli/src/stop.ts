/**
 * How a command ends on a refusal: the refusal is the person's to act on, so it is said in its own sentence and the
 * command exits 2. Anything else is a fault in the engine, thrown with its stack.
 */
type Refusal = abstract new (...args: never[]) => Error;

export const stopOn =
  (...refusals: Refusal[]) =>
  (err: unknown): never => {
    if (!refusals.some((refusal) => err instanceof refusal)) throw err;
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  };

/** The command line was not one the command takes: its usage, and exit 2. */
export function usage(line: string): never {
  console.error(line);
  process.exit(2);
}
