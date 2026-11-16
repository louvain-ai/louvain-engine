import { DEFAULT_READER, type Reading } from "@louvain/engine-core";
import { settingsOf } from "../src/config/settings.js";
import { mcp } from "../src/plugins/surface-mcp/index.js";
import { browserSessions } from "../src/server/browser-session.js";
import type { ToolRun } from "../src/server/protocol.js";
import { readerTable } from "../src/server/readers.js";
import { admit, respond } from "../src/server/respond.js";
import { routeTable } from "../src/server/routes.js";
import { listedTools } from "../src/server/tools/schema.js";

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
export async function askServer(
  asked: Asked,
  token: string,
  run: ToolRun,
  tools: ReturnType<Reading["tools"]> = listedTools(settingsOf(undefined)),
) {
  const routes = routeTable([{ name: "mcp", plugin: await mcp().create() }]);
  const read = {
    tools: () => tools,
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
  const readers = readerTable([{ principal: DEFAULT_READER, token }]);
  const answering = { readers, writeToken: null, sessions, routes, reading: () => read };
  // Admitted once, before the body, as the server does.
  const admission = admit(answering, asked.method, asked.path.split("?")[0] ?? "/", headers);
  const response = await respond(request, answering, admission);
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    ...(text ? { body: JSON.parse(text) as unknown } : {}),
  };
}
