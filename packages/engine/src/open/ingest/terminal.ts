import { counted, printable, skipSummary, skipWords } from "../terminal-text.js";
import type { IngestSummary, ItemOutcome } from "./summary.js";

/**
 * What an ingest says, in a person's words: a line for each item that changed or was skipped (an unchanged one is
 * only counted), then what the run did to the collection. Every name comes from the source, so it is made printable.
 */
export function itemLine(o: ItemOutcome): string | null {
  const key = printable(o.key);
  const by = o.reader ? ` (${printable(o.reader)})` : "";
  if ("skipped" in o) return `  ${key}: skipped, ${skipWords(o.skipped)}${by}`;
  if (o.change === "unchanged") return null;
  if (o.change === "moved") return `  ${key}: moved (was ${printable(o.from)})`;
  return `  ${key}: ${o.change}${by}`;
}

export function summaryLines(s: IngestSummary): string[] {
  const { added, updated, moved, removed, unchanged } = s.changed;
  const skipped = Object.values(s.skipped).reduce((a, b) => a + b, 0);
  const changes = [
    `${added} added`,
    `${updated} updated`,
    ...(moved ? [`${moved} moved`] : []),
    `${removed} removed`,
    `${unchanged} unchanged`,
  ];
  // Only what the keyword index did this run: an unchanged run says nothing about it.
  const keyword = [
    ...(s.keyword.indexed ? [`${s.keyword.indexed} indexed`] : []),
    ...(s.keyword.unconfigured ? [`${s.keyword.unconfigured} without an index`] : []),
    ...(s.keyword.missed ? [`${s.keyword.missed} missed (run again to retry)`] : []),
    ...(s.keywordStale ? [`${s.keywordStale} old entries not deleted (never shown)`] : []),
  ];
  return [
    `"${printable(s.collection)}": ${changes.join(", ")}; ${counted(s.passages, "new passage")}`,
    ...(skipped ? [`skipped ${skipped}: ${skipSummary(s.skipped)}`] : []),
    ...(s.removalsHeld ? [`nothing removed: ${s.removalsHeld}.`] : []),
    ...(s.adopted
      ? [`replaced ${counted(s.adopted, "path-keyed document")} with the collection's own`]
      : []),
    ...(keyword.length > 0 ? [`keyword index: ${keyword.join(", ")}`] : []),
  ];
}
