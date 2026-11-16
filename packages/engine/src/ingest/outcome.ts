import type { Run } from "./run-state.js";
import type { IngestSummary, ItemOutcome } from "./summary.js";

/** What a run counts and says, item by item: one place, so the summary and each line can never disagree. */

export function report(run: Run, o: Exclude<ItemOutcome, { skipped: string }>): void {
  run.summary.changed[o.change] += 1;
  run.onItem?.(o);
}

export function skip(run: Run, o: { key: string; why: string; reader?: string | undefined }): void {
  run.summary.skipped[o.why] = (run.summary.skipped[o.why] ?? 0) + 1;
  run.onItem?.({ key: o.key, skipped: o.why, ...(o.reader ? { reader: o.reader } : {}) });
}

export function tally(
  run: Run,
  indexed: { passages: number; keyword: keyof IngestSummary["keyword"] },
): void {
  run.summary.passages += indexed.passages;
  run.summary.keyword[indexed.keyword] += 1;
}
