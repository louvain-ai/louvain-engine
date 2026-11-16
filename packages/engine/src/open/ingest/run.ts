import {
  CollectionNameSchema,
  type IngestItem,
  type IngestSource,
  type ItemProblem,
} from "@louvain/engine-core";
import type { Writes } from "../../writes.js";
import type { FileReaderLane } from "../file-readers/index.js";
import { type LoadState, openLoadState } from "../load-core.js";
import { settleListing } from "./changes.js";
import { checkItem } from "./check-item.js";
import { heldCount, heldOf, heldTexts } from "./held.js";
import type { Collection } from "./held-types.js";
import { take } from "./item.js";
import { legacyHeld } from "./legacy.js";
import { Moves } from "./moves.js";
import { skip } from "./outcome.js";
import { claimCollection, type Hold, IngestRefused } from "./ownership.js";
import { removeItem } from "./retire.js";
import { retiredOf } from "./retired.js";
import type { Run } from "./run-state.js";
import { emptySummary, type IngestSummary, type ItemOutcome } from "./summary.js";

/** The engine's one ingest: a source's items through the one accept path, under rules written once (`changes.ts`). */

export type IngestOptions = {
  /** The source's name: the collection's owner, and what a refusal names. */
  source: string;
  /** The real path file items are read under, or null: no file is read. */
  files: string | null;
  /** `keep`: nothing is removed by absence, whatever the source lists. */
  removals: "sync" | "keep";
  /** The person takes a collection over from the source or origin that fed it before. */
  takeOver: boolean;
  /** The person lets a run remove past the limit (`absent.ts`). */
  removeMany: boolean;
  /** The readers files are read by (the configuration's), or null for a run that reads no file. */
  lane: FileReaderLane | null;
  onItem?: (o: ItemOutcome) => void;
  now?: () => Date;
};

export async function ingestFrom(
  writes: Writes,
  source: IngestSource,
  options: IngestOptions,
): Promise<IngestSummary> {
  const named = CollectionNameSchema.safeParse(source.collection);
  if (!named.success)
    throw new IngestRefused(`"${source.collection}": ${named.error.issues[0]?.message}`);
  const state = await openLoadState(writes);
  const collection: Collection = { orgId: state.orgId, name: named.data };
  const claim = {
    source: options.source,
    origin: source.origin,
    lists: source.lists,
    takeOver: options.takeOver,
  };
  const hold = await claimCollection(state.sql, collection, claim);
  try {
    const run = await startRun({ state, collection, source, options, hold });
    for await (const batch of batches(source.items())) await takeBatch(run, batch);
    if (run.listed) run.summary.removalsHeld = await settleListing(run, options.removeMany);
    return run.summary;
  } finally {
    await hold.release();
  }
}

type Start = {
  state: LoadState;
  collection: Collection;
  source: IngestSource;
  options: IngestOptions;
  hold: Hold;
};

async function startRun({ state, collection, source, options, hold }: Start): Promise<Run> {
  const whole = source.lists === "all" && options.removals === "sync";
  // Only a folder's first run replaces path-keyed documents, and only when the store holds any.
  const first = source.lists === "all" && (await heldCount(state.sql, collection)) === 0;
  return {
    state,
    collection,
    source,
    lane: options.lane,
    files: options.files,
    onItem: options.onItem,
    now: options.now ?? (() => new Date()),
    hold,
    summary: emptySummary(collection.name),
    listed: whole ? new Set() : null,
    moves: whole ? new Moves(await heldTexts(state.sql, collection)) : null,
    sendsChanges: source.lists === "some",
    adopting: first && (await legacyHeld(state.sql, state.orgId)),
  };
}

/** Items looked up together, and the most text they may hold, so memory is bounded by the batch, never the source. */
const BATCH_ITEMS = 200;
const BATCH_CHARS = 16_000_000;

/** Batches of items, each ending early at a key already in it, so every item is decided on what is stored now. */
async function* batches(
  entries: AsyncIterable<IngestItem | ItemProblem>,
): AsyncGenerator<(IngestItem | ItemProblem)[]> {
  let batch: (IngestItem | ItemProblem)[] = [];
  let keys = new Set<string>();
  let chars = 0;
  for await (const entry of entries) {
    const key = "problem" in entry ? undefined : entry.key;
    if (key !== undefined && keys.has(key)) {
      yield batch;
      [batch, keys, chars] = [[], new Set(), 0];
    }
    batch.push(entry);
    if (key !== undefined) keys.add(key);
    chars += "text" in entry && typeof entry.text === "string" ? entry.text.length : 0;
    if (batch.length < BATCH_ITEMS && chars < BATCH_CHARS) continue;
    yield batch;
    [batch, keys, chars] = [[], new Set(), 0];
  }
  if (batch.length > 0) yield batch;
}

async function takeBatch(run: Run, batch: readonly (IngestItem | ItemProblem)[]): Promise<void> {
  // A source is a plugin: what it yields is checked again here, whoever wrote it.
  const checked = batch.map((entry) =>
    "problem" in entry ? entry : checkItem(entry, String(entry.key)),
  );
  const keys = checked.flatMap((e) => ("problem" in e ? [] : [e.key]));
  const { sql } = run.state;
  const held = await heldOf(sql, run.collection, keys);
  const retired = run.sendsChanges ? await retiredOf(sql, run.collection, keys) : new Map();
  for (const entry of checked) {
    await run.hold.renew();
    // Listed whatever it holds: a file the source could not read is still in the source, never taken for gone.
    if (entry.key !== undefined) run.listed?.add(entry.key);
    if ("problem" in entry) skip(run, { key: entry.at, why: entry.problem });
    else if (entry.removed) await removeItem(run, entry.key, held.get(entry.key));
    else await take(run, entry, { held: held.get(entry.key), retired: retired.get(entry.key) });
  }
}
