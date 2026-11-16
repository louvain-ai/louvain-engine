import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_READER, type ReadableSetResolver } from "@louvain/engine-core";
import { granted } from "../src/host/standalone.js";
import { collectionOf, ITEM_FEED } from "../src/ingest/item-feed.js";
import { addReader, readerFiles, removeReader } from "../src/server/reader-files.js";
import { authorized, readersOf, readerTable } from "../src/server/readers.js";
import { EngineTokenRefused, heldToken } from "../src/server/token.js";
import { containerId } from "../src/store/ids.js";

/**
 * Readers, with no database and no server: a token reads as the one reader holding it, matched against every reader's;
 * a reader's token is a file made and read the safe way, by a name in one alphabet; and the engine's own host reads a
 * named reader's set as the loaded collections its grant names, the default reader's as every one, anyone else's as
 * none.
 */
const OWN = "o".repeat(40);
const ALICE = "a".repeat(40);
const state = () => mkdtempSync(join(tmpdir(), "engine-readers-"));

test("a token reads as the reader holding it; any other token, or none, as no reader", () => {
  const readers = readerTable([
    { principal: DEFAULT_READER, token: OWN },
    { principal: "alice", token: ALICE },
  ]);
  assert.equal(readers.of(OWN), DEFAULT_READER);
  assert.equal(readers.of(ALICE), "alice");
  for (const other of ["", "a", `${ALICE}a`, ALICE.slice(1), "x".repeat(40)])
    assert.equal(readers.of(other), null, JSON.stringify(other));
  assert.equal(readers.fromHeader(`Bearer ${ALICE}`), "alice");
  for (const header of [undefined, "", "Bearer", `Basic ${ALICE}`, `Bearer ${ALICE} extra`])
    assert.equal(readers.fromHeader(header), null, String(header));
  assert.deepEqual(readers.named, ["alice"]);
});

test("two readers holding one token are refused, and a header carries a token only as a bearer", () => {
  assert.throws(
    () =>
      readerTable([
        { principal: "alice", token: ALICE },
        { principal: "bob", token: ALICE },
      ]),
    /two readers hold one token \(one is "bob"\)/,
  );
  assert.equal(authorized(`Bearer ${OWN}`, OWN), true);
  assert.equal(authorized(undefined, ""), false, "no header carries an empty token");
  assert.equal(authorized(`Bearer ${OWN}`, ALICE), false);
});

test("a reader's token is made once, in a file only its user reads, named by the reader, and removed", () => {
  const dir = state();
  try {
    const file = addReader(dir, "alice");
    assert.equal(file, join(dir, "readers", "alice"));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "readers")).mode & 0o777, 0o700);
    assert.throws(() => addReader(dir, "alice"), /alice already has a token/);
    const token = heldToken(file);
    assert.equal(token.length >= 32, true);
    const readers = readersOf(dir, OWN);
    assert.equal(readers.of(token), "alice");
    assert.equal(readers.of(OWN), DEFAULT_READER);
    assert.deepEqual(readerFiles(dir), [{ name: "alice", file }]);
    assert.equal(removeReader(dir, "alice"), true);
    assert.equal(removeReader(dir, "alice"), false);
    assert.equal(readersOf(dir, OWN).of(token), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a name outside the alphabet, or the default reader's, is no reader's, on the command line or on disk", () => {
  const dir = state();
  try {
    for (const name of ["Alice", "../x", "a b", "", DEFAULT_READER])
      assert.throws(() => addReader(dir, name), EngineTokenRefused, JSON.stringify(name));
    addReader(dir, "bob");
    // A draft a start is writing is passed over; a file with a name that is not a reader's refuses the start.
    writeFileSync(join(dir, "readers", ".token.1.draft"), "x");
    assert.deepEqual(readersOf(dir, OWN).named, ["bob"]);
    writeFileSync(join(dir, "readers", "Notes.txt"), "x".repeat(40));
    assert.throws(() => readersOf(dir, OWN), /"Notes.txt" is not a reader's name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a collection is the segment an item's container is filed under, and only an item's", () => {
  for (const [collection, folder] of [
    ["handbook", "."],
    ["handbook", "policies/leave"],
    ["desk", ""],
  ] as const)
    assert.equal(collectionOf(containerId(ITEM_FEED, collection, folder)), collection);
  for (const container of ["ingest", "ingest/handbook", "http/folder/handbook", "other/handbook/."])
    assert.equal(collectionOf(container), null, container);
});

test("the engine's host reads a named reader's grant over what is loaded, the default reader everything, anyone else nothing", async () => {
  const loaded = [
    containerId(ITEM_FEED, "handbook", "."),
    containerId(ITEM_FEED, "handbook", "policies"),
    containerId(ITEM_FEED, "desk", "."),
    containerId(ITEM_FEED, "hand", "."),
  ];
  const asked: string[] = [];
  const projection: ReadableSetResolver = {
    readableSet: async (principal) => {
      asked.push(principal);
      return principal === DEFAULT_READER ? loaded : ["anything/a/projection/holds"];
    },
    admitted: () => [],
  };
  const host = granted(projection, { alice: ["handbook"], bob: [], constructor: ["desk"] });
  const org = "6f1c2a3e-4b5d-4c6e-8f70-819203a4b5c6";
  assert.deepEqual(await host.readableSet(DEFAULT_READER, org), loaded);
  assert.deepEqual(await host.readableSet("alice", org), loaded.slice(0, 2));
  assert.deepEqual(await host.readableSet("bob", org), []);
  assert.deepEqual(await host.readableSet("carol", org), []);
  assert.deepEqual(await host.readableSet("toString", org), []);
  assert.deepEqual(await host.readableSet("constructor", org), [loaded[2]]);
  assert.deepEqual(asked, [DEFAULT_READER, DEFAULT_READER, DEFAULT_READER]);
});
