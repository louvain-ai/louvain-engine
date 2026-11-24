import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Sql } from "postgres";
import { PermissionsUnavailable, pgRebac, ReaderNotProjected } from "../src/index.js";

/**
 * The resolver's three answers against a stand-in pool: a set, a reader never asked (looked up once, then read
 * again), and unavailable, which throws. No answer but a set the database gave is ever `[]`.
 */
type Answer = { breadth: number; set: string[] } | { code: string; hint?: string };
const ORG = "6f1c2a8e-0d4b-4c39-9a52-3e7d1f0b8c61";

/** A pool whose transactions answer from `answers`, one per read, recording each statement and its values. */
function pool(answers: Answer[]) {
  const said: { text: string; values: unknown[] }[] = [];
  const begin = async (run: (tx: unknown) => Promise<unknown>) => {
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$");
      said.push({ text, values });
      if ("code" in answer) throw Object.assign(new Error("raised"), answer);
      if (text.includes("rebac.breadth")) return [{ n: answer.breadth }];
      if (text.includes("rebac.readable_set")) return answer.set.map((c) => ({ c }));
      return [];
    };
    return run(tx);
  };
  return { sql: { begin } as unknown as Sql, said };
}

const tenantOf = (orgId: string) => `t-${orgId}`;

let lookups: { tenant: string; principal: string }[] = [];
let status = 200;
let url = "";
const daemon = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  lookups.push(JSON.parse(raw));
  res.writeHead(status, { "content-type": "application/json" }).end("{}");
});
before(async () => {
  await new Promise<void>((done) => daemon.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((done) => daemon.close(() => done())));

test("a reader's set comes back sorted, read where its org maps to, set for the transaction alone", async () => {
  const { sql, said } = pool([{ breadth: 2, set: ["ingest/handbook/a", "ingest/deals/b"] }]);
  const set = await pgRebac(sql, { tenantOf }).readableSet("alice", ORG);
  assert.deepEqual(set, ["ingest/handbook/a", "ingest/deals/b"]);
  assert.deepEqual(said[0]?.values, [`t-${ORG}`]);
  assert.match(said[0]?.text ?? "", /set_config\('rebac.tenant', \$, true\)/);
  assert.deepEqual(said[1]?.values, ["alice"]);
});

test("a reader who may read nothing reads nothing, told by the check and never by an empty scan", async () => {
  const { sql, said } = pool([{ breadth: 0, set: ["never read"] }]);
  assert.deepEqual(await pgRebac(sql, { tenantOf }).readableSet("bob", ORG), []);
  assert.equal(said.filter((s) => s.text.includes("readable_set")).length, 0);
});

test("unavailable (RB503) throws its own error, never an empty set", async () => {
  const { sql } = pool([{ code: "RB503" }]);
  await assert.rejects(
    pgRebac(sql, { tenantOf }).readableSet("carol", ORG),
    PermissionsUnavailable,
  );
});

test("a reader never asked (RB404), with no rebacd named, fails closed as not projected", async () => {
  const { sql } = pool([{ code: "RB404" }]);
  await assert.rejects(pgRebac(sql, { tenantOf }).readableSet("dave", ORG), ReaderNotProjected);
});

test("a reader never asked is looked up at rebacd once, then read again", async () => {
  lookups = [];
  status = 200;
  const { sql } = pool([{ code: "RB404" }, { breadth: 1, set: ["ingest/handbook/a"] }]);
  const set = await pgRebac(sql, { tenantOf, lookup: url }).readableSet("erin", ORG);
  assert.deepEqual(set, ["ingest/handbook/a"]);
  assert.deepEqual(lookups, [{ tenant: `t-${ORG}`, principal: "erin" }]);
});

test("a lookup that still leaves the reader unknown fails closed, and is not asked again", async () => {
  lookups = [];
  status = 200;
  const { sql } = pool([{ code: "RB404" }, { code: "RB404" }]);
  await assert.rejects(
    pgRebac(sql, { tenantOf, lookup: url }).readableSet("finn", ORG),
    ReaderNotProjected,
  );
  assert.equal(lookups.length, 1);
});

test("a lookup rebacd cannot answer, or a rebacd that is down, is unavailable", async () => {
  status = 503;
  const { sql } = pool([{ code: "RB404" }]);
  await assert.rejects(
    pgRebac(sql, { tenantOf, lookup: url }).readableSet("gus", ORG),
    PermissionsUnavailable,
  );
  const down = pool([{ code: "RB404" }]);
  const closed = "http://127.0.0.1:9";
  await assert.rejects(
    pgRebac(down.sql, { tenantOf, lookup: closed, lookupTimeoutMs: 500 }).readableSet("gus", ORG),
    PermissionsUnavailable,
  );
});

test("any other failure is thrown as it came: a missing rebac.tenant (RB400) is a bug, not a reader of nothing", async () => {
  const { sql } = pool([{ code: "RB400" }]);
  await assert.rejects(
    pgRebac(sql, { tenantOf }).readableSet("hal", ORG),
    (err: Error & { code?: string }) => {
      return err.code === "RB400";
    },
  );
});

test("a set past pg_rebac's freshness bound is renewed by one lookup; without rebacd, or still old, it is unavailable", async () => {
  lookups = [];
  status = 200;
  const old = { code: "RB503", hint: "rebac_not_fresh: re-project" };
  const renewed = pool([old, { breadth: 1, set: ["ingest/handbook/a"] }]);
  const set = await pgRebac(renewed.sql, { tenantOf, lookup: url }).readableSet("ivy", ORG);
  assert.deepEqual(set, ["ingest/handbook/a"]);
  assert.equal(lookups.length, 1);
  const alone = pool([old]);
  await assert.rejects(
    pgRebac(alone.sql, { tenantOf }).readableSet("ivy", ORG),
    PermissionsUnavailable,
  );
  const still = pool([old, old]);
  await assert.rejects(
    pgRebac(still.sql, { tenantOf, lookup: url }).readableSet("ivy", ORG),
    PermissionsUnavailable,
  );
});
