import assert from "node:assert/strict";
import { test } from "node:test";
import { datedAs } from "../src/open/source-tools/dated.js";

/**
 * A DATE GOES TO AN AGENT ONLY AS FAR AS ITS SOURCE KNEW IT (`open/source-tools/dated.ts`): no date at all for a source with
 * none (the stand-in instant a loader chose is never sent), the year or the month alone where only that is known, the
 * day without an invented time, and an instant as before. Pure.
 */
const AT = "2026-01-01T12:00:00.000Z";
test("an unknown date is sent as no date, never as the stand-in instant", () => {
  assert.deepEqual(datedAs("modifiedAt", AT, "unknown"), { dateUnknown: true });
});
test("a year or a month is sent alone, never with an invented day", () => {
  assert.deepEqual(datedAs("modifiedAt", "2025-06-30T06:00:00.000Z", "year"), { dateYear: 2025 });
  assert.deepEqual(datedAs("occurredAt", "2025-06-01T00:00:00.000Z", "month"), {
    dateMonth: "2025-06",
  });
});
test("a day is the day; an instant is the instant, under the field asked for", () => {
  assert.deepEqual(datedAs("modifiedAt", "2025-06-14T00:00:00.000Z", "day"), {
    modifiedAt: "2025-06-14",
  });
  assert.deepEqual(datedAs("occurredAt", AT), { occurredAt: AT });
  assert.deepEqual(datedAs("modifiedAt", AT, null), { modifiedAt: AT });
  assert.deepEqual(datedAs("modifiedAt", null, "unknown"), { modifiedAt: null });
});
