/**
 * One request to the server's routes, as the server answers it once the path is canonical and the body read. Who it
 * reads or writes as is decided once, before the body (`admit`), and carried here; then the route, a 404, or a 405
 * naming the methods the path takes. A route is handed the request without its credentials, a read route the engine's
 * reading for that reader, and a write route who writes. The server's own routes (the sign-in, the ingest door) are
 * rows of the same table.
 */
import type { Reading, Route } from "@louvain/engine-core";
import { type BrowserSessions, tokenMatches } from "./browser-session.js";
import type { RouteTable } from "./routes.js";
import { authorized } from "./token.js";

/** What answering needs: the read and write tokens, the browser sign-ins, the route table, and the engine's reading. */
export type Answering = {
  token: string;
  /** The write token, which only a write route takes; null when no route writes. */
  writeToken: string | null;
  sessions: BrowserSessions;
  routes: RouteTable;
  read: Omit<Reading, "reader">;
};

/** Who a request reads as (null: anyone, for an open route), who writes, or the answer that refuses it. */
export type Admission = { reader: string | null } | { writer: string } | { refused: Response };

/** The one name every holder of the read token reads as, and every holder of the write token writes as. */
const TOKEN_HOLDER = "token";

/**
 * Who a request reads or writes as, decided before its body is read. A write route takes the write token and nothing
 * else. The read token reads everywhere else. Without it, only a browser's paths answer (an open route, the sign-in
 * among them, and a route that takes the sign-in), and only at a host this server is reached at, a change only from a
 * page it served. Anything else is the same 401, on every path.
 */
export function admit(
  answering: Answering,
  method: string,
  path: string,
  headers: Headers,
): Admission {
  const { token, writeToken, sessions, routes } = answering;
  const found = routes.match(asRouted(method), path);
  const route = found !== null && "needs" in found ? found : null;
  const given = headers.get("authorization") ?? undefined;
  if (route?.needs === "write")
    return writeToken !== null && authorized(given, writeToken)
      ? { writer: TOKEN_HOLDER }
      : { refused: unauthorized() };
  if (authorized(given, token)) return { reader: TOKEN_HOLDER };
  const open = route?.needs === "none";
  if (!open && !(route?.needs === "read" && route.signIn === "cookie"))
    return { refused: unauthorized() };
  if (!sessions.knownHost(headers)) return { refused: json(421, { error: "unknown_host" }) };
  if (!reads(method) && !sessions.sameOrigin(headers))
    return { refused: json(403, { error: "cross_site" }) };
  if (open) return { reader: null };
  const reader = sessions.reader(headers);
  return reader === null ? { refused: unauthorized() } : { reader };
}

/** The request as admitted (`admit`, before its body was read): its route, or a 404 or 405. */
export async function respond(
  request: Request,
  answering: Answering,
  admission: Admission,
): Promise<Response> {
  if ("refused" in admission) return admission.refused;
  const path = new URL(request.url).pathname;
  const found = answering.routes.match(asRouted(request.method), path);
  if (found === null) return json(404, { error: "not_found" });
  if (!("needs" in found))
    return json(405, { error: "method_not_allowed" }, { allow: found.allow.join(", ") });
  const bare = withoutCredentials(request);
  if (found.needs === "none") return found.handle(bare);
  if (found.needs === "write")
    return "writer" in admission
      ? found.handle(bare, { writer: admission.writer })
      : unauthorized();
  const reader = "reader" in admission ? admission.reader : null;
  return reader === null ? unauthorized() : found.handle(bare, { ...answering.read, reader });
}

/**
 * The browser's sign-in as the server's own routes: `POST /session`, open, exchanges the read token for the cookie, and
 * `DELETE /session`, which takes the sign-in it ends, ends it here and in the browser. A browser reaches either only at
 * a host this server is reached at, and only from a page it served (`admit`).
 */
export function signInRoutes(token: string, sessions: BrowserSessions): Route[] {
  return [
    {
      method: "POST",
      path: "/session",
      needs: "none",
      handle: async (request) => {
        const given = await tokenIn(request);
        if (typeof given !== "string" || !tokenMatches(given, token))
          return json(401, { error: "wrong_token" });
        return new Response(null, { status: 204, headers: { "set-cookie": sessions.signIn() } });
      },
    },
    {
      method: "DELETE",
      path: "/session",
      needs: "read",
      signIn: "cookie",
      handle: async (_request, { reader }) =>
        new Response(null, { status: 204, headers: { "set-cookie": sessions.signOut(reader) } }),
    },
  ];
}

/** The token a sign-in's body carries, or undefined when it carries none. */
async function tokenIn(request: Request): Promise<unknown> {
  try {
    return ((await request.json()) as { token?: unknown } | null)?.token;
  } catch {
    // swallowed: a body that is not JSON carries no token, and is answered as a wrong one.
    return undefined;
  }
}

/** The answer to a request it cannot admit: the same for every path and method. */
const unauthorized = (): Response =>
  json(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="louvain-engine"' });

/** A `GET` route answers `HEAD` too: the server leaves the body unsent. */
const asRouted = (method: string): string => (method === "HEAD" ? "GET" : method);

const reads = (method: string): boolean => method === "GET" || method === "HEAD";

/** The request as a route receives it: its credentials are the server's, never the route's. */
function withoutCredentials(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  return new Request(request, { headers });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers });
