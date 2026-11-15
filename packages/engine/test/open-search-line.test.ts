import assert from "node:assert/strict";
import { test } from "node:test";
import { SHORT_ID, searchLine } from "../src/open/search-line.js";

const id = "0224df6dec534010b14f387530e331eef45bc455df741e30e54fc544e6dea4e8";

test("a search line is short enough to read on a phone: title, date and a short id", () => {
  const line = searchLine(
    { id, title: "lease-renewal", app: "http", modifiedAt: "2026-11-13T10:00:00Z" },
    1,
  );
  assert.equal(line, `1. lease-renewal · 2026-11-13 · ${id.slice(0, SHORT_ID)}`);
  assert.ok(line.length < 60);
  // The folder loader's own feed names no app either.
  assert.equal(
    searchLine(
      { id, title: "lease-renewal", app: "ingest", modifiedAt: "2026-11-14T10:00:00Z" },
      1,
    ),
    `1. lease-renewal · 2026-11-14 · ${id.slice(0, SHORT_ID)}`,
  );
});

test("a named app is shown, the engine's own feed is not, and --full-ids prints the id whole", () => {
  assert.equal(
    searchLine({ id, title: "Q3 plan", app: "gmail", dateMonth: "2026-10" }, 2, { fullIds: true }),
    `2. Q3 plan · gmail · 2026-10 · ${id}`,
  );
  assert.equal(searchLine({ id, title: null }, 3), `3. (untitled) · — · ${id.slice(0, SHORT_ID)}`);
});
