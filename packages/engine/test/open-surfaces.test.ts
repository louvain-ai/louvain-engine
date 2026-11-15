import assert from "node:assert/strict";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Reading, Route } from "@louvain/engine-core";
import { RouteClash, routeTable } from "../src/open/routes.js";
import { canonicalPath, type ServeSettings, serve } from "../src/open/serve.js";
import { mcp } from "../src/plugins/surface-mcp/index.js";

/**
 * THE SERVER SERVES WHAT THE CONFIGURATION'S SURFACES DECLARE, AND ITS OWN RULES COME FIRST: the read token before any
 * route that needs it (and before saying whether a path exists), one canonical path, a method the path does not take
 * refused with what it does, and the security headers on every answer. A browser signs in once for a cookie named for
 * this server, only at a host it is reached at and only from its own pages; a route never sees a credential; an answer
 * streams as its route writes it, and a closed connection aborts the request. MCP is one such surface, `mcp()`.
 */
const TOKEN = "t".repeat(40);
const route = (method: Route["method"], path: Route["path"]): Route => ({
  method,
  path,
  needs: "none",
  handle: async () => new Response(`${method} ${path}`),
});
const surface = (name: string, routes: Route[]) => ({ name, plugin: { routes } });

test("the most specific route answers, and a method the path does not take is told the ones it does", () => {
  const table = routeTable([
    surface("app", [route("GET", "/app/*"), route("GET", "/app/api/status")]),
  ]);
  const exact = table.match("GET", "/app/api/status");
  const prefixed = table.match("GET", "/app/index.html");
  assert.ok(exact && "path" in exact && exact.path === "/app/api/status");
  assert.ok(prefixed && "path" in prefixed && prefixed.path === "/app/*");
  assert.deepEqual(table.match("POST", "/app/api/status"), { allow: ["GET", "GET"] });
  assert.equal(table.match("GET", "/elsewhere"), null);
});

test("two surfaces on one method and path, or a path the server keeps, stop the start by name", () => {
  assert.throws(
    () => routeTable([surface("a", [route("GET", "/x")]), surface("b", [route("GET", "/x")])]),
    (err: Error) =>
      err instanceof RouteClash && /"a" and "b" both declare GET \/x/.test(err.message),
  );
  assert.throws(
    () => routeTable([surface("greedy", [route("POST", "/*")])]),
    /the surface "greedy" declares POST \/\*, a path the server keeps/,
  );
});

/** A page as a surface declares one: its files to anyone, its data to a signed-in browser, a change, and a stream. */
let stopped: () => void = () => {};
const streamStopped = new Promise<void>((resolve) => {
  stopped = resolve;
});
let cancelled: () => void = () => {};
const streamCancelled = new Promise<void>((resolve) => {
  cancelled = resolve;
});
const seen = (request: Request, reading?: Reading) =>
  Response.json({
    reader: reading?.reader ?? null,
    authorization: request.headers.has("authorization"),
    cookie: request.headers.has("cookie"),
  });
const page = {
  name: "page",
  plugin: {
    routes: [
      {
        method: "GET",
        path: "/page/*",
        needs: "none",
        handle: async () => new Response("the page"),
      },
      {
        method: "GET",
        path: "/page/api/who",
        needs: "read",
        signIn: "cookie",
        handle: async (r, read) => seen(r, read),
      },
      {
        method: "POST",
        path: "/page/api/write",
        needs: "read",
        signIn: "cookie",
        handle: async (r, read) => seen(r, read),
      },
      {
        method: "GET",
        path: "/page/api/stream",
        needs: "read",
        signIn: "cookie",
        handle: async (request) => {
          request.signal.addEventListener("abort", () => stopped(), { once: true });
          return new Response(
            new ReadableStream({
              start: (c) => c.enqueue(new TextEncoder().encode("one\n")),
              cancel: () => cancelled(),
            }),
          );
        },
      },
    ] satisfies Route[],
  },
};
const tools = await mcp().create();
const read = {
  tool: async () => ({}),
  counts: async () => ({ documents: 0, collections: [] }),
  answerer: null,
};
const settings: ServeSettings = { port: 0, toolDeadlineMs: 5_000, token: TOKEN, door: null };

let local: Server;
let bare: Server;
const portOf = (server: Server) => (server.address() as AddressInfo).port;
const base = (server: Server = local) => `http://127.0.0.1:${portOf(server)}`;
const withSurfaces = (more: Partial<ServeSettings> = {}) =>
  serve({ ...settings, ...more }, [{ name: "mcp", plugin: tools }, page], read);

before(async () => {
  local = await withSurfaces();
  bare = await serve(settings, [], read);
});
after(() => {
  local.close();
  bare.close();
});

const call = (path: string, init: RequestInit & { token?: string } = {}, server = local) =>
  fetch(`${base(server)}${path}`, {
    ...init,
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "c", version: "1" },
  },
});

const signIn = (token: string, headers: Record<string, string> = {}, server = local) =>
  fetch(`${base(server)}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base(server), ...headers },
    body: JSON.stringify({ token }),
  });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

/** A GET sent byte for byte, path and Host as given: `fetch` would normalise the one and refuse the other. */
const rawGet = (path: string, host = `127.0.0.1:${portOf(local)}`, token?: string) =>
  new Promise<number>((done, fail) =>
    httpRequest(
      {
        host: "127.0.0.1",
        port: portOf(local),
        path,
        headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    )
      .on("error", fail)
      .end(),
  );

test("mcp() answers POST /mcp for the read token, with the server's headers", async () => {
  const reply = await call("/mcp", { method: "POST", body: initialize, token: TOKEN });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("x-frame-options"), "DENY");
  const body = (await reply.json()) as { result: { serverInfo: { name: string } } };
  assert.equal(body.result.serverInfo.name, "louvain-engine");
});

test("without the token nothing is answered, not even whether a path exists, and a browser's cookie is no token", async () => {
  for (const path of ["/mcp", "/nothing"])
    assert.equal((await call(path, { method: "POST", body: initialize })).status, 401, path);
  const cookie = cookieOf(await signIn(TOKEN));
  const withCookie = await call("/mcp", {
    method: "POST",
    body: initialize,
    headers: { cookie, origin: base() },
  });
  assert.equal(withCookie.status, 401, "the tools take the read token alone");
});

test("with it: an unknown path is 404, another spelling 400, a method the route does not take 405", async () => {
  assert.equal((await call("/nothing", { token: TOKEN })).status, 404);
  assert.equal((await call("/mc%70", { token: TOKEN })).status, 404);
  assert.equal((await call("/x//mcp", { token: TOKEN })).status, 400);
  const get = await call("/mcp", { token: TOKEN });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});

test("a configuration without mcp() serves no tools, and with no page no sign-in", async () => {
  assert.equal(
    (await call("/mcp", { method: "POST", body: initialize, token: TOKEN }, bare)).status,
    404,
  );
  assert.equal((await signIn(TOKEN, {}, bare)).status, 401);
});

test("matches one canonical path: a second spelling is refused before anything reads it", async () => {
  for (const path of [
    "/page/%2e%2e/mcp",
    "/page/%2F",
    "/page//api/who",
    "/page/./x",
    "/page/..",
    "/page/a\\b",
    "*",
  ]) {
    assert.equal(canonicalPath(path), null, path);
    assert.equal(await rawGet(path, undefined, TOKEN), 400, path);
    assert.equal(await rawGet(path), 401, `${path}, without the token, says nothing`);
  }
  assert.equal(canonicalPath("/page/api/who?q=a%2Fb"), "/page/api/who");
});

test("a browser signs in with the read token for an httpOnly, SameSite=Strict cookie named for this server", async () => {
  assert.equal((await signIn("wrong")).status, 401);
  const cookie = (await signIn(TOKEN)).headers.get("set-cookie") ?? "";
  assert.match(cookie, /^louvain_engine_[\w-]{12}=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/, "plain loopback http would drop a Secure cookie");
  // A header a client sends never makes it Secure: only the configured public origin does.
  assert.doesNotMatch(
    (await signIn(TOKEN, { "x-forwarded-proto": "https" })).headers.get("set-cookie") ?? "",
    /Secure/,
  );
});

test("the cookie is named per server, so two engines on one machine never share a sign-in", async () => {
  const other = await withSurfaces();
  const name = (res: Response) => cookieOf(res).split("=")[0];
  assert.notEqual(name(await signIn(TOKEN)), name(await signIn(TOKEN, {}, other)));
  other.close();
});

test("the cookie is Secure and __Host- only behind a configured https origin", async () => {
  const behind = await withSurfaces({ publicOrigin: "https://engine.example.test" });
  const res = await fetch(`${base(behind)}/session`, {
    method: "POST",
    headers: { origin: "https://engine.example.test" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.match(res.headers.get("set-cookie") ?? "", /^__Host-louvain_engine_.*Secure/);
  behind.close();
});

test("the page goes to anyone, its data to a signed-in browser or the token, as a reader that is neither credential", async () => {
  const page = await call("/page/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal((await call("/page/api/who")).status, 401);
  const cookie = cookieOf(await signIn(TOKEN));
  const who = (await (await call("/page/api/who", { headers: { cookie } })).json()) as {
    reader: string;
    authorization: boolean;
    cookie: boolean;
  };
  assert.match(who.reader, /^browser [\w-]{16}$/);
  assert.ok(!cookie.includes(who.reader.slice(8)), "the reader is not the cookie");
  assert.deepEqual([who.authorization, who.cookie], [false, false], "a route never sees one");
  const byToken = (await (await call("/page/api/who", { token: TOKEN })).json()) as {
    reader: string;
  };
  assert.equal(byToken.reader, "token");
  const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await call("/page/api/who", { headers: { cookie: forged } })).status, 401);
});

test("a sign-out revokes the sign-in: the same cookie, sent again, is refused", async () => {
  const cookie = cookieOf(await signIn(TOKEN));
  const who = () => call("/page/api/who", { headers: { cookie } });
  assert.equal((await who()).status, 200);
  await fetch(`${base()}/session`, { method: "DELETE", headers: { cookie, origin: base() } });
  assert.equal((await who()).status, 401);
});

test("a cross-site sign-in or write is refused, signed in or not; the read token needs no origin", async () => {
  assert.equal((await signIn(TOKEN, { origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await signIn(TOKEN, { origin: "http://127.0.0.1:1" })).status, 403, "another port");
  const cookie = cookieOf(await signIn(TOKEN));
  const write = (headers: Record<string, string>) =>
    call("/page/api/write", { method: "POST", body: "{}", headers });
  assert.equal((await write({ origin: "https://elsewhere.example", cookie })).status, 403);
  assert.equal(
    (await write({ origin: "https://elsewhere.example", cookie, authorization: "Bearer wrong" }))
      .status,
    403,
    "a wrong token beside the cookie is no token",
  );
  assert.equal((await write({ origin: base(), cookie })).status, 200);
  assert.equal((await write({ authorization: `Bearer ${TOKEN}` })).status, 200);
});

test("a browser is answered only at the hosts the server is reached at, which closes DNS rebinding", async () => {
  assert.equal(await rawGet("/page/"), 200);
  assert.equal(await rawGet("/page/", `localhost:${portOf(local)}`), 200);
  assert.equal(await rawGet("/page/", "attacker.example"), 421);
  assert.equal(await rawGet("/session", `127.0.0.1:${portOf(local) + 1}`), 421);
});

test("a GET route answers HEAD with its headers and no body", async () => {
  const head = await call("/page/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("an answer streams as its route writes it, and a closed connection aborts the request and cancels the stream", async () => {
  const leave = new AbortController();
  const res = await call("/page/api/stream", { token: TOKEN, signal: leave.signal });
  const reader = res.body?.getReader();
  const first = await reader?.read();
  assert.equal(new TextDecoder().decode(first?.value), "one\n");
  leave.abort();
  await Promise.all([streamStopped, streamCancelled]);
});

// An open route and the sign-in answer before any token is seen, so an unauthenticated caller can tell which of those
// paths exist. Recorded as a `todo` until the server's design settles it.
test("tells an unauthenticated caller nothing about which paths exist", {
  todo: true,
}, async () => {
  assert.equal(
    (await fetch(`${base()}/session`)).status,
    (await fetch(`${base()}/nothing`)).status,
  );
});
