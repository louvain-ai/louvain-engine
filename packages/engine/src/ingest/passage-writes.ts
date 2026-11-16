/**
 * What a build does after passages are written, handed to a write in its hooks (`writes.ts` `WriteHooks.passageWrites`):
 * given the kind of vector (`passage` or `context`) and the passages' ids, it does its own work on them, best effort,
 * never a condition of the write. A write handed none reads `plainPassageWrites`, which does nothing.
 */
export type PassageWriteHooks = {
  afterWrite: ((kind: "passage" | "context", ids: readonly string[]) => Promise<void>) | null;
};

/** Run the build's hook on passages just written, if it has one that does anything. */
export async function afterPassagesWritten(
  hooks: PassageWriteHooks,
  kind: "passage" | "context",
  ids: readonly string[],
): Promise<void> {
  if (ids.length > 0) await hooks.afterWrite?.(kind, ids);
}

/** The open build's: nothing after a write. */
export const plainPassageWrites: PassageWriteHooks = { afterWrite: null };
