import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, it } from "node:test";
import { serve as listen, readerTable } from "@louvain/engine";
import {
  createPluginRegistry,
  DEFAULT_READER,
  defineEngine,
  type Plugin,
} from "@louvain/engine-core";
import { agent, anthropic, scripted } from "../src/ask/plugins.js";
import { app } from "../src/index.js";

/**
 * The app's routes on the engine's own server, as `./engine up` serves them: an answer at a time per sign-in, Stop
 * that ends it at the server, and Ask that says which setting it needs when it has no key, or that it has no answerer.
 * Answers come from the example answerer, paced so one is still running while the test acts; the tools are stand-ins.
 */

const TOKEN = "k".repeat(40);
const tools = {
  tools: () => [],
  tool: async (name: string) =>
    name === "louvain_search_sources"
      ? {
          sources: [
            { id: "d1", title: "lease-renewal", excerpt: "The lease renews in September." },
          ],
        }
      : {
          title: "lease-renewal",
          text: "The lease renews in September. The landlord offered four per cent.",
        },
  counts: async () => ({ documents: 1, collections: [{ name: "handbook", documents: 1 }] }),
};

/** The server with the app its one surface; `answerer` is what `engine.config.ts` names, started, or null for none. */
async function serve(
  answerer: Plugin<"answerer"> | null,
  env: Record<string, string> = {},
): Promise<{ server: Server; base: string }> {
  Object.assign(process.env, env);
  const started = (await createPluginRegistry(defineEngine({ answerer }))).one("answerer");
  const readers = readerTable([{ principal: DEFAULT_READER, token: TOKEN }]);
  const server = await listen(
    { port: 0, toolDeadlineMs: 60_000, token: TOKEN, readers, door: null },
    [{ name: "app", plugin: await app().create() }],
    () => ({ ...tools, answerer: started }),
  );
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function signedIn(base: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/session`, {
    method: "POST",
    headers: { origin: base },
    body: JSON.stringify({ token: TOKEN }),
  });
  return { origin: base, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "" };
}

const askFrom = (base: string, headers: Record<string, string>, signal?: AbortSignal) =>
  fetch(`${base}/app/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: "When does the lease renew?" }),
    ...(signal ? { signal } : {}),
  });

// No test here reaches a model provider: the runner's key and address are set aside, and every model this file calls
// answers on loopback (the refusing server below), so a key in the environment spends nothing.
const runner = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};
let served: { server: Server; base: string };
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  served = await serve(scripted({ paceMs: 40 }));
});
after(() => {
  served.server.close();
  restore("ANTHROPIC_API_KEY", runner.key);
  restore("ANTHROPIC_BASE_URL", runner.url);
});

it("the app's routes: answers one question at a time per sign-in, and Stop frees it at once", async () => {
  const headers = await signedIn(served.base);
  const stop = new AbortController();
  const first = await askFrom(served.base, headers, stop.signal);
  const reader = (first.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  assert.equal((await askFrom(served.base, headers)).status, 409);
  stop.abort();
  let next = await askFrom(served.base, headers);
  for (let i = 0; next.status === 409 && i < 50; i++) next = await askFrom(served.base, headers);
  assert.equal(next.status, 200);
  const lines = (await next.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(lines.at(-1), { type: "done" });
});

it("the app's routes: serves search and status only to a signed-in browser", async () => {
  assert.equal((await fetch(`${served.base}/app/api/search?q=lease`)).status, 401);
  const headers = await signedIn(served.base);
  const page = (await (
    await fetch(`${served.base}/app/api/search?q=lease`, { headers })
  ).json()) as { sources: { title: string }[]; matched: boolean };
  assert.deepEqual(
    page.sources.map((h: { title: string }) => h.title),
    ["lease-renewal"],
  );
  assert.equal(page.matched, true);
  const status = (await (await fetch(`${served.base}/app/api/status`, { headers })).json()) as {
    ask: unknown;
  };
  assert.deepEqual(status.ask, { ready: true, answering: "scripted" });
});

it("the app's routes: the page goes to anyone, and the bare mount to its slash", async () => {
  // The server says where a surface's page is from its first route, and the wrapper finds the app by that line.
  const [first] = (await app().create()).routes;
  assert.deepEqual([first?.method, first?.path, first?.needs], ["GET", "/app/*", "none"]);
  const page = await fetch(`${served.base}/app/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const bare = await fetch(`${served.base}/app`, { redirect: "manual" });
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get("location"), "/app/");
  assert.equal(
    (await fetch(`${served.base}/app/api/elsewhere`)).status,
    401,
    "data paths need the sign-in",
  );
});

it("the app's routes: serve marked's own module and licence from the installed package, to anyone", async () => {
  const lexer = await fetch(`${served.base}/app/js/vendor/marked.js`);
  assert.equal(lexer.status, 200);
  assert.match(lexer.headers.get("content-type") ?? "", /javascript/);
  const { Lexer } = (await import(
    `data:text/javascript;base64,${Buffer.from(await lexer.text()).toString("base64")}`
  )) as typeof import("marked");
  assert.equal(Lexer.lex("# A heading", { gfm: true })[0]?.type, "heading");
  const licence = await fetch(`${served.base}/app/js/vendor/LICENSE-marked.txt`);
  assert.equal(licence.status, 200);
  assert.match(await licence.text(), /MIT/);
});

it("the app without a model key: says which setting Ask needs, and spends nothing", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { server, base } = await serve(agent({ model: anthropic({ model: "claude-sonnet-5-5" }) }));
  const headers = await signedIn(base);
  const res = await askFrom(base, headers);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "no_key", needs: "ANTHROPIC_API_KEY" });
  server.close();
});

it("the app with no answerer named: says so in one sentence, and the status says Ask is not ready", async () => {
  const { server, base } = await serve(null);
  const headers = await signedIn(base);
  const res = await askFrom(base, headers);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    error: "no_answerer",
    message: "Ask has no answerer: name one in engine.config.ts, then start the engine again.",
  });
  const status = await fetch(`${base}/app/api/status`, { headers });
  assert.deepEqual(((await status.json()) as { ask: unknown }).ask, { ready: false });
  server.close();
});

it("the app with a key the model refuses: names the key on the page, and says nothing of the provider's words", async () => {
  const refusing = createServer((_req, res) =>
    res
      .writeHead(401, { "content-type": "application/json" })
      .end(
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      ),
  );
  await new Promise<void>((done) => refusing.listen(0, "127.0.0.1", done));
  Object.assign(process.env, {
    ANTHROPIC_API_KEY: "sk-wrong",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(refusing.address() as AddressInfo).port}`,
  });
  const { server, base } = await serve(agent({ model: anthropic({ model: "claude-sonnet-5-5" }) }));
  const res = await askFrom(base, await signedIn(base));
  const lines = (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(lines.at(-1), { type: "failed", why: "key" });
  assert.doesNotMatch(JSON.stringify(lines), /x-api-key/);
  server.close();
  refusing.close();
});
