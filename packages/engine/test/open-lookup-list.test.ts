import assert from "node:assert/strict";
import { test } from "node:test";
import { containerName } from "../src/open/source-tools/containers.js";
import {
  identifierOf,
  isKeyShaped,
  matchedOn,
  type Stored,
} from "../src/open/source-tools/identifier.js";
import { endOf } from "../src/open/source-tools/search-apps.js";

/**
 * The decidable halves of `louvain_lookup_source` and the container listing, with no database: which stored value IS
 * an identifier (exactly, never a near miss), how a container is named and how a list ends. The fenced reads have
 * database tests of their own. Every name here is invented.
 */
const stored = (over: Partial<Stored>): Stored => ({
  id: "f".repeat(64),
  title: "Something else",
  url: null,
  nativeId: "n-1",
  ...over,
});
const is = (over: Partial<Stored>, written: string) =>
  matchedOn(stored(over), identifierOf(written));

test("each stored value that IS the identifier, and why", () => {
  // Whether a title opens with a key is the build's exact tier's to say (`exact-seam.ts`); the rule reads its mark.
  assert.equal(
    is({ title: "ENG-4902: Fix the login loop", titleKey: true }, "ENG-4902"),
    "titleKey",
  );
  assert.equal(is({ title: "ENG-4902: Fix the login loop" }, "ENG-4902"), null);
  assert.equal(is({ title: "eng-4902" }, "ENG-4902"), "title");
  assert.equal(is({ title: "Retro notes" }, "retro notes"), "title");
  assert.equal(is({ nativeId: "ENG-4902" }, "ENG-4902"), "externalId");
  assert.equal(
    is(
      { url: "https://tracker.example.invalid/browse/ENG-4902" },
      "https://tracker.example.invalid/browse/ENG-4902/",
    ),
    "url",
  );
  const id = "a".repeat(64);
  assert.equal(is({ id }, id), "id");
  assert.equal(is({ id }, `https://louvain.example.invalid/app/doc/${id}`), "id");
  assert.equal(is({ title: "plan", nativeId: "notes/plan.md" }, "plan.md"), "fileName");
  assert.equal(is({ title: "plan", nativeId: "notes/plan.md" }, "notes/plan.md"), "externalId");
});

test("a word, a number or a version is not key-shaped", () => {
  for (const word of ["Retro", "plan", "42", "v1.2", "notes/plan.md"])
    assert.equal(isKeyShaped(word), false, word);
  for (const key of ["ENG-4902", "web#14", "OPS-311"]) assert.equal(isKeyShaped(key), true, key);
});

test("a near miss is never a match", () => {
  assert.equal(
    is({ title: "plan", nativeId: "doc-77" }, "plan.md"),
    null,
    "a stem alone is no file",
  );
  assert.equal(
    is(
      { url: "https://tracker.example.invalid/browse/ENG-49" },
      "https://tracker.example.invalid/browse/ENG-4",
    ),
    null,
  );
});

test("a container is named by its path, or its connector where the path names nothing", () => {
  assert.equal(containerName("http/folder/notes/2026"), "notes/2026");
  assert.equal(containerName("http/folder/_"), "(top folder)");
  assert.equal(containerName("slack/acme/general"), "general");
  assert.equal(containerName("upload/acme-space/all"), "upload");
  assert.equal(
    containerName("upload/acme-space/file-0b3c1f9e-1d2a-4c3b-9a8f-7e6d5c4b3a21"),
    "upload",
  );
  assert.equal(containerName("gmail/acme/0b3c1f9e-1d2a-4c3b-9a8f-7e6d5c4b3a21"), "gmail");
});

test("a list ends with all N, or at least N when the count stopped short", () => {
  assert.equal(endOf({ total: 3, totalIsLowerBound: false, hasMore: false }), "That is all 3.");
  assert.match(
    endOf({ total: 120, totalIsLowerBound: false, hasMore: true }),
    /^120 in all; pass nextCursor/,
  );
  assert.match(
    endOf({ total: 10000, totalIsLowerBound: true, hasMore: true }),
    /^At least 10000 sources/,
  );
  assert.equal(endOf({ total: 0, totalIsLowerBound: false, hasMore: false }), "That is all 0.");
});
