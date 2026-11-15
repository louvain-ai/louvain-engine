/**
 * The tool server as a function: the configured surfaces' routes and `POST /ingest` behind its own token when a
 * configured source opens that door, on loopback. Every path is canonical or refused, who a request reads as is decided
 * before its body is read (`respond.ts`), a body is capped before anything parses it, every answer carries the security
 * headers and streams as its route writes it, a closed connection aborts the request a route is answering, and a tool
 * call's reply is bounded by the deadline while the work under way runs on. The caller binds the reads and hands over
 * the surfaces and the reading (`mcp-server.ts`), so nothing here chooses them.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type Reading, type Started, withDeadline } from "@louvain/engine-core";
import { log } from "../observability/logging.js";
import { telemetry } from "../telemetry.js";
import { browserSessions, SECURITY_HEADERS } from "./browser-session.js";
import { authorized } from "./engine-token.js";
import { answerIngest, INGEST_MAX_BODY_BYTES, type IngestDoor } from "./ingest-http.js";
import { type Answering, admit, respond, unauthorized } from "./respond.js";
import { routeTable } from "./routes.js";
import { ToolInputError } from "./source-tools/tool-helpers.js";

export type ServeSettings = {
  port: number;
  /** How long a tool call's reply may take. */
  toolDeadlineMs: number;
  /** The read token, for every read route and the browser's sign-in. */
  token: string;
  /** The source `POST /ingest` opens and its token, or null for no door (`ingest-http.ts`). */
  door: IngestDoor | null;
  /** The origin of a proxy in front, when browsers reach the server through one. */
  publicOrigin?: string | undefined;
};

/** The most a request body may be: a tool call's arguments are a query and a few ids. */
const MAX_BODY_BYTES = 1_000_000;
/** How long a whole request may take to arrive, and its headers (Node enforces both on its 30-second sweep). */
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;

type Reply = { status: number; headers?: Record<string, string>; body?: unknown };

export async function serve(
  settings: ServeSettings,
  surfaces: readonly Started<"surface">[],
  read: Omit<Reading, "reader">,
): Promise<Server> {
  const routes = routeTable(surfaces);
  const server = createServer();
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  await new Promise<void>((listening) => server.listen(settings.port, "127.0.0.1", listening));
  // The sign-in is named for the port the server listens on, so two engines on one machine never share one.
  const { port } = server.address() as AddressInfo;
  const answering: Answering = {
    token: settings.token,
    sessions: browserSessions(settings.token, { port, publicOrigin: settings.publicOrigin }),
    routes,
    read: { ...read, tool: withinDeadline(read.tool, settings.toolDeadlineMs) },
  };
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    // A route that throws is a 500, its exception to telemetry, never to the caller.
    answer(req, res, settings.door, answering).catch((err: unknown) => {
      telemetry.error("open.http.route", err);
      if (res.headersSent) res.destroy();
      else send(res, { status: 500, body: { error: "internal" } });
    });
  });
  return server;
}

/**
 * The request's path exactly as sent, or null when it has a second spelling: no leading slash, an encoded slash,
 * backslash or dot, an empty segment, or a dot segment. One form is matched, and nothing is decoded into another.
 */
export function canonicalPath(url: string | undefined): string | null {
  const path = (url ?? "/").split("?")[0] ?? "/";
  return !path.startsWith("/") || /%2f|%5c|%2e|\/\/|\/\.\.?(\/|$)|\\/i.test(path) ? null : path;
}

/**
 * A tool call past its deadline is the caller's answer, `isError`, never a hung request. The deadline bounds the
 * reply only: the search or read already under way runs on, since its reads take no signal.
 */
function withinDeadline(run: Reading["tool"], ms: number): Reading["tool"] {
  const seconds = Math.round(ms / 1000);
  return (name, args) =>
    withDeadline(() => run(name, args), ms, {
      onTimeout: () => {
        throw new ToolInputError(`That call did not finish within ${seconds} s.`);
      },
    });
}

/** One request: the ingest door, or who it reads as before its body, the path canonical, the body capped, then `respond`. */
async function answer(
  req: IncomingMessage,
  res: ServerResponse,
  door: IngestDoor | null,
  answering: Answering,
): Promise<void> {
  const path = canonicalPath(req.url);
  const method = req.method ?? "GET";
  if (door !== null && path === "/ingest" && method === "POST") return throughDoor(req, res, door);
  const headers = headersOf(req);
  const admission = admit(answering, method, path ?? "", headers);
  // Refused before its body is read: the body is never read, and the connection closes.
  if ("refused" in admission) return refuse(req, res, admission.refused);
  if (path === null) return send(res, { status: 400, body: { error: "not_canonical" } });
  const body = await readBody(req, res, MAX_BODY_BYTES);
  if (body === null) return;
  const stopped = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) stopped.abort();
  });
  const carries = method !== "GET" && method !== "HEAD";
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method,
    headers,
    signal: stopped.signal,
    ...(carries ? { body } : {}),
  });
  await relay(res, method, await respond(request, answering));
}

/** `POST /ingest`: the door's own token before the body, its own larger cap, then the one ingest. */
async function throughDoor(req: IncomingMessage, res: ServerResponse, door: IngestDoor) {
  if (!authorized(req.headers.authorization, door.token)) return refuse(req, res, unauthorized());
  const body = await readBody(req, res, INGEST_MAX_BODY_BYTES);
  if (body === null) return;
  await answerIngest(door, body).then((reply) => send(res, reply), failed(res));
}

/** A request refused before its body: answered, its body left unread, its connection closed. */
function refuse(req: IncomingMessage, res: ServerResponse, refusal: Response): Promise<void> {
  req.resume();
  return relay(res, req.method ?? "GET", refusal, { connection: "close" });
}

/** The request's headers as the web-standard `Headers` a route reads. */
function headersOf(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  return headers;
}

/** A `Response`, written with the server's own headers beside its own, and its body sent as it is written. */
async function relay(
  res: ServerResponse,
  method: string,
  response: Response,
  more: Record<string, string> = {},
): Promise<void> {
  res.writeHead(response.status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    ...Object.fromEntries(response.headers),
    ...more,
  });
  if (method === "HEAD" || response.body === null) {
    await response.body?.cancel();
    return void res.end();
  }
  const body = response.body.getReader();
  // A closed connection cancels the stream at once, even while its route waits to write; the request is aborted too.
  res.once("close", () => {
    body.cancel().catch((err: unknown) => telemetry.error("open.http.stream", err));
  });
  for (let chunk = await body.read(); !chunk.done; chunk = await body.read())
    res.write(chunk.value);
  res.end();
}

function send(res: ServerResponse, reply: Reply): void {
  const text = reply.body === undefined ? undefined : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    ...reply.headers,
    ...(text ? { "content-type": "application/json" } : {}),
  });
  res.end(text);
}

/** The body as text, or null when it passed `limit` (answered 413 and the connection dropped). */
function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
): Promise<string | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      if (size > limit) return;
      size += chunk.length;
      if (size <= limit) return void chunks.push(chunk);
      // Answered once: a chunk already read past the limit is dropped, never answered again.
      send(res, { status: 413, headers: { connection: "close" }, body: { error: "too_large" } });
      req.destroy();
      done(null);
    });
    req.on("end", () => done(size > limit ? null : Buffer.concat(chunks).toString("utf8")));
  });
}

/** An ingest that fails is said in the server's log, scrubbed as every line is, and answered 500, never left hanging. */
const failed = (res: ServerResponse) => (err: unknown) => {
  telemetry.error("engine.ingest", err);
  log.error(`ingest failed: ${err instanceof Error ? err.message : String(err)}`);
  send(res, { status: 500, body: { error: "internal" } });
};
