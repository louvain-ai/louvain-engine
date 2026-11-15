import type { IngestSource } from "@louvain/engine-core";
import type { FileReaderLane } from "../file-readers/index.js";
import type { LoadState } from "../load-core.js";
import type { Collection, Held } from "./held-types.js";
import type { Moves } from "./moves.js";
import type { Hold } from "./ownership.js";
import type { replays } from "./retired.js";
import type { IngestSummary, ItemOutcome } from "./summary.js";

/** What one run carries from item to item: where it writes, what it has seen, and what it has said. */
export type Run = {
  state: LoadState;
  collection: Collection;
  source: IngestSource;
  /** The readers files are read by, or null when the run reads no file. */
  lane: FileReaderLane | null;
  /** The real path file items are read under, or null: no file is read. */
  files: string | null;
  onItem: ((o: ItemOutcome) => void) | undefined;
  now: () => Date;
  hold: Hold;
  s: IngestSummary;
  /** The keys a whole listing named, when removal by absence is on. */
  listed: Set<string> | null;
  moves: Moves | null;
  /** Sources that send changes rather than a whole listing: a replay or an older revision is refused, not taken. */
  sendsChanges: boolean;
  /** A first run over documents an earlier loader wrote: each it replaces is withdrawn, never left beside it. */
  adopting: boolean;
};

/** A revision of an item, read and ready: its words, its fingerprint, its place, and what read it. */
export type Version = {
  text: string;
  revision: string;
  place: string;
  reader?: string;
  mtime?: Date;
};

/** What the collection holds of one key: its stored events, and the revisions it retired. */
export type Stored = { held: Held | undefined; retired: Parameters<typeof replays>[2] };
