import { OpenAcceptRefused } from "../src/ingest/accept.js";
import { indexOpen } from "../src/ingest/indexer.js";
import { acceptInto, openLoadState } from "../src/ingest/load.js";
import type { Revision } from "../src/ingest/revision.js";
import type { Writes } from "../src/ingest/writes.js";

/**
 * Revisions through the open accept path and index step, one at a time, counted: how a test loads a corpus of
 * revisions it wrote by hand. Ingest itself loads items (`ingest/ingest.ts`), each made a revision by `itemEvent`.
 */
export type LoadSummary = {
  accepted: number;
  duplicate: number;
  refused: Record<string, number>;
  containers: number;
  passages: number;
  /** Keyword entries: written, no index configured, missed (a rerun retries), skipped (nothing to index; a rerun does not change it). */
  keyword: { indexed: number; unconfigured: number; missed: number; skipped: number };
};

export async function loadEvents(
  writes: Writes,
  events: Iterable<Revision> | AsyncIterable<Revision>,
  o: { onProgress?: (s: LoadSummary, seen: number) => void; every?: number } = {},
): Promise<LoadSummary> {
  const state = await openLoadState(writes);
  const s: LoadSummary = {
    accepted: 0,
    duplicate: 0,
    refused: {},
    containers: state.known.size,
    passages: 0,
    keyword: { indexed: 0, unconfigured: 0, missed: 0, skipped: 0 },
  };
  let seen = 0;
  for await (const event of events) {
    seen += 1;
    let loaded: Awaited<ReturnType<typeof acceptInto>> &
      Awaited<ReturnType<typeof indexOpen>>[number];
    try {
      const accepted = await acceptInto(state, event);
      const [indexed] = await indexOpen(state, state.orgId, [accepted.eventId]);
      if (!indexed) throw new Error("indexOpen answered nothing for the event");
      loaded = { ...accepted, ...indexed };
    } catch (err) {
      if (err instanceof OpenAcceptRefused) {
        s.refused[err.reason] = (s.refused[err.reason] ?? 0) + 1;
        continue;
      }
      throw err;
    }
    if (loaded.status === "accepted") s.accepted += 1;
    else s.duplicate += 1;
    s.containers = state.known.size;
    s.passages += loaded.passages;
    s.keyword[loaded.keyword] += 1;
    if (o.onProgress && seen % (o.every ?? 1000) === 0) o.onProgress(s, seen);
  }
  return s;
}
