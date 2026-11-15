import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine, settle } from "./engine.js";
import { writing } from "./golden.js";
import { planOf, scansOf } from "./plans.js";
import { CASES } from "./search.cases.js";
import {
  distinctStatements,
  keyOf,
  readSnapshots,
  type Snapshot,
  writeSnapshots,
} from "./snapshots.js";
import { capture, fenced, normalised, type Sent, senderOf } from "./statements.js";

/**
 * WHAT THE ENGINE SENDS TO POSTGRES, PINNED AS TEXT. The cases of the search golden run again with every statement
 * captured, and each distinct statement must be one recorded under `sql/`: the same text once whitespace is folded
 * (`statements.ts` says how), with the same number of parameters, under the same `set local` settings. The comparison
 * is one set across every case and the load that builds the corpus (its writes among them). A refactor that only
 * moves or re-indents a query passes, and says which raw texts changed; one that changes a word, a predicate, a
 * parameter or a read's settings fails, naming the statement. Which cases send a statement is recorded for a reader,
 * not compared: caches with a lifetime decide whether a later case sends a read again.
 *
 * The plan's shape is recorded beside each statement and compared on the same Postgres major version only, and a
 * change is REPORTED, never failed: on a corpus this small two plans often cost nearly the same, and which one wins
 * moves between fresh databases with the same code (measured: two fenced reads' `event_log` scans flipped between a
 * sequential and an index scan in two of four fresh runs, statistics over random ids being the likely cause). A guard
 * that fails at random teaches people to ignore it; the text is the gate, and the plan is evidence beside it.
 *
 *   pnpm --filter @louvain/engine test:db          # compare (needs TEST_AUTH_DATABASE_URL)
 *   pnpm --filter @louvain/engine test:db:record   # record the answers and statements as they are, and say what moved
 */
const DIR = new URL("./sql/", import.meta.url);
let engine: Engine;
const now: Snapshot[] = [];
const recorded = readSnapshots(DIR);

before(async () => {
  if (skipWithoutDatabase) return;
  // The loader is heard too: a read a cache keeps (a workspace's settings, for a quarter of a minute) is sent first
  // while loading, and by a case only once the cache has lapsed, so without the load it would come and go with time.
  let loading: Sent[] = [];
  engine = await openEngine("sqltext", {
    around: async (writes, load) => {
      loading = await capture(writes.sql, load);
    },
  });
  const heard = [{ name: "loading the corpus", sent: loading }];
  for (const c of CASES)
    heard.push({ name: c.name, sent: await capture(engine.sql, () => c.run(engine)) });
  // Plans are read on tables settled after the cases, whatever the cases wrote.
  await settle(engine.sql);
  const [{ version }] =
    (await engine.sql`select current_setting('server_version_num')::int / 10000 as version`) as [
      { version: number },
    ];
  for (const { snapshot, sample } of distinctStatements(heard, senderOf))
    now.push({ ...snapshot, plan: await planOf(engine.sql, sample), postgres: version });
});

after(async () => {
  if (writing && !skipWithoutDatabase)
    for (const line of writeSnapshots(DIR, recorded, now)) console.log(line);
  await engine?.close();
});

const show = (s: Snapshot) => `${s.file || s.sender}\n${normalised(s.raw)}`;

test("every statement sent is one recorded, and every one recorded is still sent", {
  skip: skipWithoutDatabase || writing,
}, () => {
  const was = new Set(recorded.map(keyOf));
  const is = new Set(now.map(keyOf));
  const added = now.filter((s) => !was.has(keyOf(s)));
  const gone = recorded.filter((s) => !is.has(keyOf(s)));
  assert.ok(
    added.length + gone.length === 0,
    [
      `${gone.length} recorded statement(s) no longer sent, ${added.length} new:`,
      ...gone.map((s) => `- ${show(s)}`),
      ...added.map((s) => `+ ${show(s)}`),
    ].join("\n\n"),
  );
});

test("a statement whose raw text alone changed is said, not failed", {
  skip: skipWithoutDatabase || writing,
}, (t) => {
  const was = new Map(recorded.map((s) => [keyOf(s), s]));
  for (const s of now) {
    const old = was.get(keyOf(s));
    if (old && old.raw !== s.raw)
      t.diagnostic(`text unchanged after normalisation; raw differs: ${old.file}`);
  }
});

test("a changed plan is said, and a fenced read's changed scans by name", {
  skip: skipWithoutDatabase || writing,
}, (t) => {
  const was = new Map(recorded.map((s) => [keyOf(s), s]));
  for (const s of now) {
    const old = was.get(keyOf(s));
    if (!old || old.postgres !== s.postgres || old.plan === s.plan) continue;
    t.diagnostic(`plan changed: ${old.file}\n  was ${old.plan}\n  now ${s.plan}`);
    const [before, after] = [scansOf(old.plan).join(", "), scansOf(s.plan).join(", ")];
    if (fenced(s.raw) && before !== after)
      t.diagnostic(`a fenced read's scans changed: ${old.file}\n  was ${before}\n  now ${after}`);
  }
});

/**
 * THE LOOKUP'S INDEXED READS, AS PLANNED. A title read by its whole text and a URL read by its digest each have an
 * index of their own (`source_revision_org_title_key_idx`, `source_revision_org_url_key_idx`); whether the plan on
 * this corpus uses it is said here for each such statement, never failed, by the rule above.
 */
const INDEXED_READS = [
  { read: /lower\(left\(r\.title/, index: "source_revision_org_title_key_idx" },
  { read: /md5\(r\.url\)/, index: "source_revision_org_url_key_idx" },
];

test("the lookup's whole-title and URL reads are said with the index each plan uses", {
  skip: skipWithoutDatabase || writing,
}, (t) => {
  for (const { read, index } of INDEXED_READS)
    for (const s of now.filter((s) => read.test(s.raw)))
      t.diagnostic(`${s.file}: ${s.plan?.includes(index) ? "uses" : "does NOT use"} ${index}`);
});
