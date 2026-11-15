/**
 * The read stage: an item's words, from its text or the file it names (`content.ts`, inside the run's folder and the
 * readers' bounds), with the revision they make and the folder they sit in. What cannot be read is a skip, said.
 */
import { containerId } from "../../db-ids.js";
import { contentOf } from "./content.js";
import { type ContentItem, containerOf, revisionOf } from "./item-event.js";
import { ITEM_FEED } from "./item-feed.js";
import type { Run, Version } from "./run-state.js";

export async function readItem(run: Run, item: ContentItem): Promise<Read> {
  const content = await contentOf(item, run.files, run.lane);
  if ("skipped" in content) return content;
  return {
    ...content,
    revision: revisionOf(item, content.text),
    place: containerId(ITEM_FEED, run.collection.name, containerOf(item)),
  };
}

/** What reading an item gave: its version, or why it was skipped. */
export type Read = Version | { skipped: string; reader?: string };
