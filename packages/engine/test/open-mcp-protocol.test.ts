import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsOf } from "../src/config/settings.js";
import { mcpRoute, type ToolRun } from "../src/server/protocol.js";
import { authorized } from "../src/server/readers.js";
import { ToolInputError } from "../src/server/tools/arguments.js";
import { listedTools } from "../src/server/tools/schema.js";
import { askServer } from "./mcp-answer.js";

/** The open tool server's protocol, with no database: the tool run is a stand-in. */
const TOKEN = "a".repeat(64);
const AUTH = `Bearer ${TOKEN}`;
const calls: string[] = [];
const run: ToolRun = async (name, args) => {
  calls.push(name);
  if (args.query === "bad") throw new ToolInputError("That cursor belongs to another search.");
  if (args.query === "boom") throw new Error("connection to 10.0.0.5 refused: secret detail");
  return { sources: [{ id: "doc-1", title: "Runbook" }], hasMore: false };
};
/** What a Streamable HTTP client sends with every POST: its token, JSON, and that it reads JSON or a stream. */
const sent = (authorization: string | undefined, more: Record<string, string> = {}) => ({
  ...(authorization === undefined ? {} : { authorization }),
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  ...more,
});
const postAs = (body: unknown, authorization: string | undefined, more?: Record<string, string>) =>
  askServer(
    {
      method: "POST",
      path: "/mcp",
      headers: sent(authorization, more),
      body: JSON.stringify(body),
    },
    TOKEN,
    run,
  );
const post = (body: unknown) => postAs(body, AUTH);

test("no token, a wrong token or a malformed header is a 401, and no tool runs", async () => {
  calls.length = 0;
  for (const auth of [undefined, "Bearer nope", `Basic ${TOKEN}`, TOKEN, ""]) {
    const reply = await postAs(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "louvain_search_sources", arguments: { query: "x" } },
      },
      auth,
    );
    assert.equal(reply.status, 401, `auth ${auth}`);
    assert.match(reply.headers["www-authenticate"] ?? "", /^Bearer/);
  }
  assert.deepEqual(calls, []);
  assert.equal(authorized(AUTH, TOKEN), true);
  assert.equal(authorized(`Bearer ${TOKEN}x`, TOKEN), false);
});

test("tools/list names exactly search, lookup and read, with no collection, client or file-bytes arguments", async () => {
  const reply = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(reply.status, 200);
  const tools = (
    reply.body as { result: { tools: { name: string; inputSchema: { properties: object } }[] } }
  ).result.tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    ["louvain_search_sources", "louvain_lookup_source", "louvain_read_source"],
  );
  for (const tool of tools)
    for (const absent of ["space", "client", "original", "download", "knownAt", "app"])
      assert.equal(absent in tool.inputSchema.properties, false, `${tool.name} offers ${absent}`);
});

test("the open server's words are for loaded files: no product, no person, no app, no unused question", async () => {
  // Each engine's tools follow its own settings: an engine that searches no question offers none.
  const list = async (searchQuestion?: boolean) => {
    const settings = settingsOf(
      searchQuestion === undefined ? undefined : { retrieval: { searchQuestion } },
    );
    const reply = await askServer(
      {
        method: "POST",
        path: "/mcp",
        headers: sent(AUTH),
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
      },
      TOKEN,
      run,
      listedTools(settings),
    );
    return (
      reply.body as {
        result: {
          tools: { name: string; description: string; inputSchema: { properties: object } }[];
        };
      }
    ).result.tools;
  };
  const off = await list(false);
  const text = JSON.stringify(off);
  for (const never of [/this person/i, /gmail|slack|google-drive|Drive file/i, /the deployment/i])
    assert.doesNotMatch(text, never);
  assert.equal("question" in (off[0]?.inputSchema.properties ?? {}), false, "nothing searches it");
  assert.ok("container" in (off[0]?.inputSchema.properties ?? {}), "a folder narrows instead");
  assert.ok(
    "question" in ((await list(true))[0]?.inputSchema.properties ?? {}),
    "offered when searched",
  );
  const unset = await list();
  assert.ok("question" in (unset[0]?.inputSchema.properties ?? {}), "searched by default");
  assert.doesNotMatch(JSON.stringify(unset), /the deployment/i);
});

test("initialize, ping, a notification and an unknown method, as the SDK answers them", async () => {
  const initialize = (protocolVersion: string) =>
    post({
      jsonrpc: "2.0",
      id: 3,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "c", version: "1" } },
    });
  const init = await initialize("2025-03-26");
  assert.equal(
    (init.body as { result: { protocolVersion: string } }).result.protocolVersion,
    "2025-03-26",
    "a version the server speaks is agreed",
  );
  const unknownVersion = await initialize("1999-01-01");
  assert.equal(
    (unknownVersion.body as { result: { protocolVersion: string } }).result.protocolVersion,
    "2025-11-25",
    "a version the server does not speak gets its newest",
  );
  const ping = await post({ jsonrpc: "2.0", id: 4, method: "ping" });
  assert.deepEqual((ping.body as { result: unknown }).result, {});
  const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(note.body, undefined);
  const unknown = await post({ jsonrpc: "2.0", id: 5, method: "resources/subscribe" });
  assert.equal((unknown.body as { error: { code: number } }).error.code, -32601);
  const tool = await post({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "louvain_ask", arguments: {} },
  });
  assert.equal((tool.body as { error: { code: number } }).error.code, -32602);
});

test("a tool's result carries the JSON as text and as structured content; failures are results, never the exception", async () => {
  const call = (query: string) =>
    post({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "louvain_search_sources", arguments: { query } },
    });
  type Res = {
    result: { content: { text: string }[]; structuredContent?: unknown; isError?: boolean };
  };
  const ok = (await call("runbook")).body as Res;
  assert.deepEqual(JSON.parse(ok.result.content[0]?.text ?? ""), ok.result.structuredContent);
  const bad = (await call("bad")).body as Res;
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.content[0]?.text, "That cursor belongs to another search.");
  const boom = (await call("boom")).body as Res;
  assert.equal(boom.result.isError, true);
  assert.doesNotMatch(boom.result.content[0]?.text ?? "", /10\.0\.0\.5|secret/);
});

test("only POST /mcp runs anything, and bad JSON is a parse error", async () => {
  const other = await askServer(
    { method: "POST", path: "/other", headers: sent(AUTH), body: "{}" },
    TOKEN,
    run,
  );
  assert.equal(other.status, 404);
  const get = await askServer(
    { method: "GET", path: "/mcp", headers: sent(AUTH), body: "" },
    TOKEN,
    run,
  );
  assert.equal(get.status, 405);
  const junk = await askServer(
    { method: "POST", path: "/mcp", headers: sent(AUTH), body: "{not json" },
    TOKEN,
    run,
  );
  assert.equal(junk.status, 400);
  assert.equal((junk.body as { error: { code: number } }).error.code, -32700);
});

test("the transport's rules are the SDK's: the spec's Accept header, and a protocol version the server speaks", async () => {
  const list = { jsonrpc: "2.0", id: 8, method: "tools/list" };
  calls.length = 0;
  assert.equal((await postAs(list, AUTH, { accept: "application/json" })).status, 406);
  assert.equal(
    (await postAs(list, AUTH, { "mcp-protocol-version": "1999-01-01" })).status,
    400,
    "a version header the server does not speak is refused",
  );
  assert.equal((await postAs(list, AUTH, { "mcp-protocol-version": "2025-06-18" })).status, 200);
  assert.deepEqual(calls, []);
});

test("MCP is the server's read route: POST /mcp, a web Request in and a JSON Response out", async () => {
  const route = mcpRoute(
    { tool: run, tools: () => listedTools(settingsOf(undefined)) },
    "0.0.0-test",
  );
  assert.deepEqual([route.method, route.path, route.needs], ["POST", "/mcp", "read"]);
  const response = await route.handle(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: sent(AUTH),
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
});
