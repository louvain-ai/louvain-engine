import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

/**
 * An index older than the engine answers a tiered `/search` as a plain one (no `asked`): the call fails, so the page
 * goes on without its words test and notes, and the process says once, with the fix, that the index needs
 * `./engine up`. Any other refusal throws without saying it.
 */
test("an index that answers without tiers fails the call and says so once", async () => {
  let reply: { status: number; body: unknown } = { status: 200, body: { hits: [] } };
  const server = createServer((_req, res) => {
    res.statusCode = reply.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  process.env.LOUVAIN_BM25_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { bm25Tiers } = await import("../src/kg/read/keyword/tiers.js");
  const { bm25Endpoint } = await import("../src/kg/read/bm25.js");
  const index = bm25Endpoint();
  const ask = { orgId: "o", containers: ["c"], query: "leese", limit: 1 };
  const said: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const log = console.log;
  console.log = (...args: unknown[]) => said.push(args.join(" "));
  process.stdout.write = ((chunk: string) =>
    said.push(String(chunk)) > 0) as typeof process.stdout.write;
  try {
    await assert.rejects(bm25Tiers(index, ask), /older than this engine/);
    await assert.rejects(bm25Tiers(index, ask), /older than this engine/);
  } finally {
    console.log = log;
    process.stdout.write = out;
  }
  assert.equal(said.filter((line) => line.includes("run ./engine up")).length, 1, said.join("\n"));

  reply = {
    status: 200,
    body: { hits: [{ id: "e1", score: 2, words: 1 }], asked: 1, corrected: ["leese"] },
  };
  assert.deepEqual(await bm25Tiers(index, ask), {
    hits: [{ id: "e1", score: 2, words: 1 }],
    asked: 1,
    completed: [],
    corrected: ["leese"],
    dropped: [],
  });
  reply = { status: 500, body: {} };
  await assert.rejects(bm25Tiers(index, ask), /bm25 tiers 500/);
  await new Promise((done) => server.close(done));
});
