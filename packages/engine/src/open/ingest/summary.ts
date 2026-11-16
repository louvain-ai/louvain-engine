/** What one run did, item by item and in all: the words a person reads in the summary. */

type Change = "added" | "updated" | "moved" | "removed" | "unchanged";

export type ItemOutcome =
  | { key: string; change: Exclude<Change, "moved">; reader?: string }
  | { key: string; change: "moved"; from: string; reader?: string }
  | { key: string; skipped: string; reader?: string };

export type IngestSummary = {
  collection: string;
  changed: Record<Change, number>;
  skipped: Record<string, number>;
  passages: number;
  keyword: { indexed: number; unconfigured: number; missed: number; skipped: number };
  /** Why nothing was removed by absence, when a whole listing removed nothing it might have. */
  removalsHeld: string | null;
  /** Keyword entries a withdrawal could not delete; never shown, since every hit is read again from the store. */
  keywordStale: number;
  /** Path-keyed documents (`legacy.ts`), replaced by this run's own. */
  adopted: number;
};

export function emptySummary(collection: string): IngestSummary {
  return {
    collection,
    changed: { added: 0, updated: 0, moved: 0, removed: 0, unchanged: 0 },
    skipped: {},
    passages: 0,
    keyword: { indexed: 0, unconfigured: 0, missed: 0, skipped: 0 },
    removalsHeld: null,
    keywordStale: 0,
    adopted: 0,
  };
}
