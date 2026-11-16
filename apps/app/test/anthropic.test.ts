import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, it } from "node:test";
import { anthropic } from "../src/ask/anthropic.js";
import type { ModelEvent, Turn } from "../src/ask/model.js";

/**
 * Anthropic's model against a stand-in for the Messages API that streams what the real one does: the request it
 * sends, a tool call and its reply carried back, the words streamed, and a cancel that closes the request.
 */

type Seen = {
  body: Record<string, unknown>;
  headers: IncomingMessage["headers"];
  closed: Promise<void>;
};
const seen: Seen[] = [];
let reply: (res: ServerResponse) => void = () => {};

const sse = (res: ServerResponse, events: object[]) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events)
    res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`);
};
const start = {
  type: "message_start",
  message: {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 1 },
  },
};
const finish = (stop: string) => [
  {
    type: "message_delta",
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 20 },
  },
  { type: "message_stop" },
];

let server: ReturnType<typeof createServer>;
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const closed = new Promise<void>((done) => res.on("close", done));
      seen.push({ body: JSON.parse(body), headers: req.headers, closed });
      reply(res);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const model = () => anthropic({ apiKey: "sk-test", model: "claude-sonnet-5-5" });
const SEARCH = { name: "search_documents", description: "Search.", input: { type: "object" } };
const turn = (o: Partial<Turn> = {}): Turn => ({
  system: "Answer.",
  messages: [{ role: "user", text: "When does the lease renew?" }],
  tools: [SEARCH],
  maxTokens: 1000,
  signal: new AbortController().signal,
  ...o,
});
const events = async (t: Turn) => {
  const all: ModelEvent[] = [];
  for await (const e of model().turn(t)) all.push(e);
  return all;
};
/** A turn that answers in two pieces of text and ends. */
const ANSWER_WORDS = [
  start,
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "It renews in September " },
  },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "[1]." } },
  { type: "content_block_stop", index: 0 },
  ...finish("end_turn"),
];
const doneOf = (all: ModelEvent[]) =>
  all.find((e) => e.type === "done") as Extract<ModelEvent, { type: "done" }>;

it("Anthropic's model asks with the configured model, the tools streamed eagerly and the server-side fallback", async () => {
  reply = (res) => {
    sse(res, [
      start,
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "search_documents", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":"lease"}' },
      },
      { type: "content_block_stop", index: 0 },
      ...finish("tool_use"),
    ]);
    res.end();
  };
  const result = doneOf(await events(turn()));
  const { body, headers } = seen.at(-1) as Seen;
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.equal(body.max_tokens, 1000);
  assert.match(String(headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.ok(
    (body.tools as { eager_input_streaming: boolean }[]).every((t) => t.eager_input_streaming),
  );
  assert.equal(result.stop, "calls");
  assert.deepEqual(result.message.calls, [
    { id: "tu_1", name: "search_documents", input: { query: "lease" } },
  ]);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20 });
});

it("Anthropic's model sends its own reply back unchanged with the tool's result, and streams the answer's words", async () => {
  const replay = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id: "tu_1", name: "search_documents", input: { query: "lease" } },
  ];
  reply = (res) => {
    sse(res, ANSWER_WORDS);
    res.end();
  };
  const all = await events(
    turn({
      messages: [
        { role: "user", text: "When does the lease renew?" },
        { role: "assistant", text: "", calls: [], carry: replay },
        { role: "tool", results: [{ callId: "tu_1", text: "[1] lease-renewal" }] },
      ],
    }),
  );
  const words = all.flatMap((e) => (e.type === "text" ? [e.text] : []));
  const result = doneOf(all);
  const sent = (seen.at(-1) as Seen).body.messages as { role: string; content: unknown }[];
  assert.deepEqual(sent[1], { role: "assistant", content: replay });
  assert.deepEqual(sent[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "tu_1", content: "[1] lease-renewal", is_error: false },
    ],
  });
  assert.deepEqual(words, ["It renews in September ", "[1]."]);
  assert.equal(result.message.text, "It renews in September [1].");
  assert.equal(result.stop, "end");
});

it("Anthropic's model closes its request when the answer is cancelled", async () => {
  reply = (res) => sse(res, [start]);
  const stop = new AbortController();
  const asking = events(turn({ signal: stop.signal }));
  while (seen.length < 3) await new Promise((r) => setImmediate(r));
  stop.abort();
  await assert.rejects(asking);
  await (seen.at(-1) as Seen).closed;
});
