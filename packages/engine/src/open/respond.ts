/**
 * One request to the server's routes, as the server answers it once the path is canonical and the body read. First who
 * it reads as (`admit`); then the sign-in the server keeps at `/session`, or the route, a 404, or a 405 naming the
 * methods the path takes. A route is handed the request without its credentials, and a read route the engine's reading
 * for that reader.
 */
import type { Reading } from "@louvain/engine-core";
import { type BrowserSessions, tokenMatches } from "./browser-session.js";
import { authorized } from "./engine-token.js";
import type { RouteTable } from "./routes.js";

/** Where a browser signs in (`POST`, the read token in its body) and out (`DELETE`). */
const SIGN_IN = "/session";

/** What answering needs: the read token, the browser sign-ins, the route table, and the engine's reading. */
export type Answering = {
  token: string;
  sessions: BrowserSessions;
  routes: RouteTable;
  read: Omit<Reading, "reader">;
};

/** Who a request reads as (null: anyone, for an open route or the sign-in), or the answer that refuses it. */
export type Admission = { reader: string | null } | { refused: Response };

/** The one name every holder of the read token reads as. */
const TOKEN_READER = "token";

/**
 * Who a request reads as, decided before its body is read. The read token reads everywhere. Without it, only a
 * browser's paths answer (an open route, a route that takes the sign-in, and the sign-in itself), and only at a host
 * this server is reached at, a change only from a page it served. Anything else is the same 401, on every path.
 */
export function admit(
  answering: Answering,
  method: string,
  path: string,
  headers: Headers,
): Admission {
  const { token, sessions, routes } = answering;
  if (authorized(headers.get("authorization") ?? undefined, token)) return { reader: TOKEN_READER };
  const found = routes.match(asRouted(method), path);
  const route = found !== null && "needs" in found ? found : null;
  const open = path === SIGN_IN ? routes.signsIn : route?.needs === "none";
  if (!open && !(route?.needs === "read" && route.signIn === "cookie"))
    return { refused: unauthorized() };
  if (!sessions.knownHost(headers)) return { refused: json(421, { error: "unknown_host" }) };
  if (!reads(method) && !sessions.sameOrigin(headers))
    return { refused: json(403, { error: "cross_site" }) };
  if (open) return { reader: null };
  const reader = sessions.reader(headers);
  return reader === null ? { refused: unauthorized() } : { reader };
}

export async function respond(request: Request, answering: Answering): Promise<Response> {
  const path = new URL(request.url).pathname;
  const admission = admit(answering, request.method, path, request.headers);
  if ("refused" in admission) return admission.refused;
  if (path === SIGN_IN) return signIn(request, answering);
  const found = answering.routes.match(asRouted(request.method), path);
  if (found === null) return json(404, { error: "not_found" });
  if (!("needs" in found))
    return json(405, { error: "method_not_allowed" }, { allow: found.allow.join(", ") });
  const bare = withoutCredentials(request);
  if (found.needs === "none") return found.handle(bare);
  const { reader } = admission;
  return reader === null ? unauthorized() : found.handle(bare, { ...answering.read, reader });
}

/** `POST /session` exchanges the read token for the cookie; `DELETE /session` ends the sign-in, here and in the browser. */
async function signIn(request: Request, { token, sessions }: Answering): Promise<Response> {
  if (request.method === "DELETE")
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": sessions.signOut(request.headers) },
    });
  if (request.method !== "POST")
    return json(405, { error: "method_not_allowed" }, { allow: "POST, DELETE" });
  const given = await tokenIn(request);
  if (typeof given !== "string" || !tokenMatches(given, token))
    return json(401, { error: "wrong_token" });
  return new Response(null, { status: 204, headers: { "set-cookie": sessions.signIn() } });
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
export const unauthorized = (): Response =>
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
