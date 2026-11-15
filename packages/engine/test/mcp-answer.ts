import { browserSessions } from "../src/open/browser-session.js";
import type { ToolRun } from "../src/open/mcp-protocol.js";
import { respond } from "../src/open/respond.js";
import { routeTable } from "../src/open/routes.js";
import { mcp } from "../src/plugins/surface-mcp/index.js";

/** A request as a test writes it: its method, path, headers and body text. */
export type Asked = {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
};

/**
 * One request as the tool server answers it, with `mcp()` its one surface and `run` its tools (`respond.ts`): the
 * status, the headers and the JSON body, with no database and no socket.
 */
export async function askServer(asked: Asked, token: string, run: ToolRun) {
  const routes = routeTable([{ name: "mcp", plugin: await mcp().create() }]);
  const read = {
    tool: run,
    counts: async () => ({ documents: 0, collections: [] }),
    answerer: null,
  };
  const headers = new Headers();
  for (const [name, value] of Object.entries(asked.headers))
    if (value !== undefined) headers.set(name, value);
  const carries = asked.method !== "GET" && asked.method !== "HEAD";
  const request = new Request(`http://127.0.0.1${asked.path}`, {
    method: asked.method,
    headers,
    ...(carries ? { body: asked.body } : {}),
  });
  const sessions = browserSessions(token, { port: 0 });
  const response = await respond(request, { token, sessions, routes, read });
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    ...(text ? { body: JSON.parse(text) as unknown } : {}),
  };
}
