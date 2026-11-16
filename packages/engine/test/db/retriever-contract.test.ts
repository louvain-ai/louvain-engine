import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";

/**
 * A retriever's records are read again as the keyword index's hits are (`search/pool.ts`,
 * `read/records/as-passages.ts`): a retriever with an index of its own hands back record ids, and the engine keeps
 * only those this reader may read, in their version current as of the search, inside every narrowing, each shown by
 * the engine's own passage. Here a planted retriever, reading as staff, returns ids its reading never handed it: a
 * readable record survives with the engine's own text; a hidden one, a garbage id, one dated after the as-of and one
 * outside the narrowing are each dropped and counted (`search.retriever_foreign_dropped`); a superseded version is read
 * as the index's hits are, a known defect (below). Another workspace's record is the same org predicate as a garbage
 * id here: this harness loads one workspace.
 */
let engine: Engine;
before(async () => {
  if (skipWithoutDatabase) return;
  engine = await openEngine("contract");
});
after(async () => {
  await engine?.close();
});

/** A corpus document's record by its key: its current version, or with `older` one it replaced. */
async function recordOf(key: string, older = false): Promise<string> {
  const [row] = await engine.sql<{ id: string }[]>`
    select r.event_id as id from source_revision r join source_document d on d.id = r.source_id
     where d.native_id = ${key} and (r.event_id = d.current_event_id) = ${!older}
     order by r.event_id limit 1`;
  assert.ok(row, `${key}${older ? " (older)" : ""} is in the corpus`);
  return row.id;
}

/** A pool of one retriever that returns these records, searched as staff; what it kept and what it dropped. */
async function planted(
  recordIds: string[],
  opts: { asOf?: string; narrow?: { containers?: string[]; window?: { from?: string } } } = {},
) {
  const { retrieverPool } = await import("../../src/search/pool.js");
  const { registerTelemetry } = await import("../../src/observability/telemetry.js");
  const dropped: number[] = [];
  registerTelemetry("contract", {
    count: (name, n) => {
      if (name === "search.retriever_foreign_dropped") dropped.push(n);
    },
    timing: () => {},
    error: () => {},
  });
  const pool = retrieverPool([
    {
      name: "planted",
      plugin: {
        candidates: async () => ({
          legs: [{ leg: "planted", rows: recordIds.map((recordId) => ({ recordId })) }],
          degraded: [],
        }),
      },
    },
  ]);
  const found = await pool(engine.readContext, engine.owner("staff"), "anything", null, 24, {
    limit: 24,
    recall: "full",
    rerank: false,
    ...opts,
  });
  return { kept: found.found.map((f) => f.evidence), dropped: dropped.reduce((a, b) => a + b, 0) };
}

test("a readable record is kept, read by the engine; a hidden one and a garbage id are dropped", {
  skip: skipWithoutDatabase,
}, async () => {
  const readable = await recordOf("handbook/procurement");
  const { kept, dropped } = await planted([
    readable,
    await recordOf("finance/fin-2207"),
    "not-a-record",
  ]);
  assert.deepEqual(
    kept.map((e) => e.recordId),
    [readable],
  );
  const [own] = await engine.sql<{ text: string }[]>`
    select text from passage where event_id = ${readable} order by seq limit 1`;
  assert.equal(
    kept[0]?.text,
    own?.text,
    "the engine's own passage, not anything the retriever said",
  );
  assert.equal(dropped, 2);
});

/**
 * A superseded version is read as the keyword index's hits are, which keeps it: a revision written as an event
 * with no record key is not known to be superseded (`SUPERSEDED_SHOWN`, `search.cases.ts`). This is that defect, here.
 */
test("a superseded version is dropped", {
  skip: skipWithoutDatabase,
  todo: "a known defect, recorded by the case named in SUPERSEDED_SHOWN (search.cases.ts)",
}, async () => {
  const { kept } = await planted([await recordOf("handbook/remote-working", true)]);
  assert.deepEqual(kept, []);
});

test("one dated after the as-of is dropped; one before it is kept", {
  skip: skipWithoutDatabase,
}, async () => {
  const before = await recordOf("handbook/code-of-conduct");
  const later = await recordOf("engineering/architecture-notes");
  const { kept, dropped } = await planted([later, before], { asOf: "2024-06-01T00:00:00Z" });
  assert.deepEqual(
    kept.map((e) => e.recordId),
    [before],
  );
  assert.equal(dropped, 1);
});

test("one outside the search's narrowing is dropped; one inside it is kept", {
  skip: skipWithoutDatabase,
}, async () => {
  const inside = await recordOf("handbook/procurement");
  const outside = await recordOf("engineering/architecture-notes");
  const { kept, dropped } = await planted([outside, inside], {
    narrow: { containers: [engine.container("handbook")] },
  });
  assert.deepEqual(
    kept.map((e) => e.recordId),
    [inside],
  );
  assert.equal(dropped, 1);
});

test("one outside the search's date window is dropped; one inside it is kept", {
  skip: skipWithoutDatabase,
}, async () => {
  const inside = await recordOf("handbook/procurement");
  const outside = await recordOf("handbook/code-of-conduct");
  const { kept, dropped } = await planted([outside, inside], {
    narrow: { window: { from: "2025-01-01T00:00:00Z" } },
  });
  assert.deepEqual(
    kept.map((e) => e.recordId),
    [inside],
  );
  assert.equal(dropped, 1);
});
