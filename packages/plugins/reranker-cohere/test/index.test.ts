import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { cohere } from "../src/index.js";

/**
 * Cohere's rerank shape against a stand-in: the key goes as a bearer, the texts as strings, the relevance comes back by
 * index into the order asked; a refusal or a missing text is a named failure; no key stops the configuration.
 */
type Reply = { status: number; body: unknown };
let reply: () => Reply;
let seen: { req: IncomingMessage; body: { model: string; documents: string[] } } | undefined;
let url = "";
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  seen = { req, body: JSON.parse(raw) };
  const { status, body } = reply();
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
});
before(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((done) => server.close(() => done())));

test("the relevance comes back by index, in the order asked, and the key goes as a bearer", async () => {
  reply = () => ({
    status: 200,
    body: {
      results: [
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.2 },
      ],
    },
  });
  const r = await cohere({ url, apiKey: "k3y" }).create();
  const got = await r.rerank({ query: "q", texts: ["a", "b"] });
  assert.deepEqual(got, { ok: true, scores: [0.2, 0.9] });
  assert.equal(seen?.req.url, "/v2/rerank");
  assert.equal(seen?.req.headers.authorization, "Bearer k3y");
  assert.deepEqual(seen?.body.documents, ["a", "b"]);
  assert.equal(r.model, "rerank-v3.5");
});

test("a refusal or an unscored text is a named failure", async () => {
  const cases: [Reply, RegExp][] = [
    [{ status: 429, body: {} }, /did not answer \(it answered 429\)/],
    [
      { status: 200, body: { results: [{ index: 0, relevance_score: 1 }] } },
      /did not score every text/,
    ],
  ];
  for (const [answer, failure] of cases) {
    reply = () => answer;
    const got = await (await cohere({ url, apiKey: "k" }).create()).rerank({
      query: "q",
      texts: ["a", "b"],
    });
    assert.ok(!got.ok);
    assert.match(got.failure, failure);
  }
});

test("no key stops the configuration in a sentence", () => {
  const saved = process.env.COHERE_API_KEY;
  delete process.env.COHERE_API_KEY;
  try {
    assert.throws(() => cohere({}), /a key is needed: set COHERE_API_KEY, or pass apiKey/);
  } finally {
    if (saved !== undefined) process.env.COHERE_API_KEY = saved;
  }
});
