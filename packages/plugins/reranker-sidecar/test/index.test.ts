import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { sidecar } from "../src/index.js";

/**
 * The local reranker against a stand-in sidecar: the raw scores come back squashed into [0, 1] in the order asked, the
 * bearer is sent when one is set, and a sidecar that answers wrongly, runs another model or is not there is a named
 * failure, never scores.
 */
type Reply = { status: number; body: unknown };
let reply: (req: IncomingMessage, body: { documents: { id: string; text: string }[] }) => Reply;
let seen: IncomingMessage | undefined;
let url = "";
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  seen = req;
  const { status, body } = reply(req, JSON.parse(raw));
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
});
before(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((done) => server.close(() => done())));

const started = async (settings: Partial<Parameters<typeof sidecar>[0]> = {}) =>
  sidecar({ url, model: "m", token: "", ...settings }).create();

test("raw scores come back in [0, 1], in the order the texts were asked", async () => {
  // Best first, as the sidecar sorts them: the plugin puts each back by its id.
  reply = (_req, body) => ({
    status: 200,
    body: {
      model: "m",
      results: [
        { id: "1", score: 2 },
        { id: "0", score: -2 },
      ],
    },
  });
  const got = await (await started()).rerank({ query: "q", texts: ["a", "b"] });
  assert.ok(got.ok);
  assert.deepEqual(
    got.scores.map((s) => s.toFixed(4)),
    ["0.1192", "0.8808"],
  );
});

test("the bearer goes to the sidecar when one is set", async () => {
  reply = () => ({ status: 200, body: { model: "m", results: [{ id: "0", score: 0 }] } });
  await (await started({ token: "t0k" })).rerank({ query: "q", texts: ["a"] });
  assert.equal(seen?.headers.authorization, "Bearer t0k");
});

test("a sidecar that fails, runs another model or leaves a text unscored is a named failure", async () => {
  const cases: [Reply, RegExp][] = [
    [{ status: 503, body: { error: "busy" } }, /did not answer \(it answered 503\)/],
    [{ status: 200, body: { model: "other", results: [] } }, /runs other, not m/],
    [
      { status: 200, body: { model: "m", results: [{ id: "0", score: 1 }] } },
      /did not score every text/,
    ],
  ];
  for (const [answer, failure] of cases) {
    reply = () => answer;
    const got = await (await started()).rerank({ query: "q", texts: ["a", "b"] });
    assert.ok(!got.ok);
    assert.match(got.failure, failure);
  }
});

test("a sidecar that is not there is a named failure", async () => {
  const got = await (await sidecar({ url: "http://127.0.0.1:9", model: "m" }).create()).rerank({
    query: "q",
    texts: ["a"],
  });
  assert.ok(!got.ok);
  assert.match(got.failure, /the rerank sidecar at http:\/\/127\.0\.0\.1:9 did not answer/);
});

test("a setting that is wrong stops the configuration in a sentence", () => {
  assert.throws(() => sidecar({ url: "not a url" }), /the reranker "sidecar" refuses its settings/);
});

test("wide log-odds keep the model's strict order where the logistic rounds them to 1", async () => {
  const raw = [56.5, 88.25, 35.5, 76.5, 56.5];
  reply = () => ({
    status: 200,
    body: { model: "m", results: raw.map((score, i) => ({ id: String(i), score })) },
  });
  const got = await (await started()).rerank({ query: "q", texts: raw.map(String) });
  assert.ok(got.ok);
  const order = (scores: readonly number[]) =>
    scores.map((_, i) => i).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  assert.deepEqual(order(got.scores), order(raw), "the engine's sort gives the model's order");
  assert.ok((got.scores[1] ?? 0) > (got.scores[3] ?? 0), "88.25 above 76.5, strictly");
  assert.ok((got.scores[3] ?? 0) > (got.scores[0] ?? 0), "76.5 above 56.5, strictly");
  assert.equal(got.scores[0], got.scores[4], "equal raw scores stay equal");
  assert.ok(got.scores.every((s) => s > 0.999 && s <= 1));
});

test("scores within ±36 are the plain logistic, bit for bit", async () => {
  const raw = [9.5, -3.25, 0, 12, -10, 9.5, 35];
  reply = () => ({
    status: 200,
    body: { model: "m", results: raw.map((score, i) => ({ id: String(i), score })) },
  });
  const got = await (await started()).rerank({ query: "q", texts: raw.map(String) });
  assert.ok(got.ok);
  assert.deepEqual(
    got.scores,
    raw.map((x) => 1 / (1 + Math.exp(-x))),
  );
});
