import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { recordPredicates } from "../src/kg/read/filters.js";
import {
  type AddedFilters,
  arrived,
  FilterUnsupported,
  genreIn,
  markedBy,
  noAddedFilters,
} from "../src/sources/filter-seam.js";

/** A tag the fragments are written with; nothing here runs a statement, so it never connects. */
const sql = postgres("postgres://fragments@127.0.0.1:1/none", { onnotice: () => {} });

/**
 * The open build's filters after the fence (`noAddedFilters`, what a read handed no hook reads) refuse a mark, an
 * arrivals view, a participant and a genre with a sentence rather than answering unfiltered, match a sender by the
 * actor alone and keep nothing of a narrowing.
 */
const reader = { orgId: "00000000-0000-4000-8000-000000000001", containers: ["c"] };
const open: AddedFilters = noAddedFilters;

test("the open build's filters refuse a mark, an arrivals view, a participant and a genre, and narrow to nothing", async () => {
  assert.throws(() => markedBy(open, reader, "ann"), FilterUnsupported);
  assert.throws(() => markedBy(open, reader, "ann"), /no `starredBy` filter/);
  assert.throws(() => arrived(open, sql, "e", "r"), /no `news` filter/);
  assert.throws(() => genreIn(open, sql, reader.orgId, ["bulk"]), /no `genre` filter/);
  const org = reader.orgId;
  const predicates = (f: Parameters<typeof recordPredicates>[3]) =>
    recordPredicates(sql, open, org, f);
  assert.throws(() => predicates({ participants: ["a@x.test"] }), /`participants`/);
  assert.throws(() => predicates({ genre: { include: ["bulk"] } }), /`genre`/);
  assert.throws(() => predicates({ genre: { exclude: ["bulk"] } }), /`genre`/);
  assert.doesNotThrow(() => predicates({ sender: "a@x.test" }));
  // A narrowing keeps nothing: no document is read first, and the listing's predicate is `false`.
  const narrow = {
    include: ["00000000-0000-4000-8000-000000000002"],
    exclude: [],
    added: [],
    removed: [],
    collections: [],
    folderFiles: { workspaces: [], ids: [] },
    ruledRecords: [],
    bounded: false,
  };
  assert.deepEqual(await open.narrowedReach(reader, narrow), []);
  assert.ok(open.narrowed(sql, reader, narrow));
});

test("the open build declares a record whole only by its own `whole` key", () => {
  assert.deepEqual(open.wholeKeys, ["whole"]);
});
