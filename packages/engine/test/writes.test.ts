import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk } from "../src/ingest/cut.js";
import { openPassageRules, type PassageRules } from "../src/ingest/passage-rules.js";
import { OPEN_KEYWORD_INDEX } from "../src/kg/read/keyword-index.js";
import { afterPassagesWritten, plainPassageWrites } from "../src/passage-write-seam.js";
import { noAddedFilters } from "../src/sources/filter-seam.js";
import { type Writes, writeHooksOf } from "../src/writes.js";

/**
 * WHAT A BUILD ADDS TO A WRITE TRAVELS IN THE WRITE'S OWN VALUE (`writes.ts`), and a hook it leaves out is the open
 * build's own constant. A write handed no hooks cuts a text as one part, does nothing after it writes, names an app by
 * the open rule and keeps document entries; one handed some writes by those. No process binding is read.
 */
const sql = {} as Writes["sql"];

test("a write handed no hooks reads each one as the open build's own constant", () => {
  const open = writeHooksOf({ sql, hooks: {} });
  assert.equal(open.passageRules, openPassageRules);
  assert.equal(open.passageWrites, plainPassageWrites);
  assert.equal(open.filters, noAddedFilters);
  assert.equal(open.keyword, OPEN_KEYWORD_INDEX);
  assert.deepEqual(chunk(open.passageRules, "A note.\n\nUnsubscribe"), ["A note. Unsubscribe"]);
});

test("a write handed hooks cuts and follows a write by them, and by none it was not handed", async () => {
  const parts: PassageRules = { ...openPassageRules, parts: (text) => text.split("\n\n") };
  const written: [string, readonly string[]][] = [];
  const hooks = {
    passageRules: parts,
    passageWrites: {
      afterWrite: async (kind: string, ids: readonly string[]) => void written.push([kind, ids]),
    },
  };
  const mine = writeHooksOf({ sql, hooks });
  assert.equal(mine.passageRules, parts);
  assert.equal(mine.keyword, OPEN_KEYWORD_INDEX);
  assert.deepEqual(chunk(mine.passageRules, "A note.\n\nUnsubscribe"), ["A note.", "Unsubscribe"]);
  await afterPassagesWritten(mine.passageWrites, "passage", ["p1"]);
  await afterPassagesWritten(mine.passageWrites, "context", []);
  await afterPassagesWritten(plainPassageWrites, "passage", ["p2"]);
  assert.deepEqual(
    written,
    [["passage", ["p1"]]],
    "nothing for no ids, nothing from the open build's",
  );
});
