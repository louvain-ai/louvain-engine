/**
 * The tool server's start: the read token from the state directory it is handed and the ingest door its configuration opens, the cursor key
 * from the read token, the default org checked, then `serve()` with the configured surfaces and the engine's reading
 * (its tools, its counts, its answerer), and where everything is said. A token it may not read, or a door set wrong, is
 * a `ServerRefused` in one sentence, never a stack trace.
 */
import type { Server } from "node:http";
import { join, relative } from "node:path";
import type { Started } from "@louvain/engine-core";
import { environment } from "../config/environment.js";
import { serverSettings } from "../config/open.js";
import type { Engine } from "../engine.js";
import { EngineTokenRefused, engineToken } from "./engine-token.js";
import { type IngestDoor, IngestDoorRefused, ingestDoor } from "./ingest-http.js";
import { loadedCounts } from "./loaded-counts.js";
import { openTools, type ToolEngine, toolList } from "./mcp-tools.js";
import { openOrgId } from "./org.js";
import { serve } from "./serve.js";
import { useCursorToken } from "./source-tools/cursor-key.js";

/** A server that cannot start, in the sentence that says why. */
export class ServerRefused extends Error {}

/** The server's two doors: the read token every tool call carries, and the configured source POST /ingest opens, if any. */
type Doors = { token: string; from: string; door: IngestDoor | null };

/** What the server runs on: the engine's reads, its plugins, its store and its writes (the ingest door's). */
export type ServedEngine = ToolEngine & Pick<Engine, "writes">;

/** The tool server for this engine, its token kept in `state` (the install's `.engine/`, or a profile's). */
export async function startToolServer(engine: ServedEngine, state: string): Promise<Server> {
  const { plugins } = engine;
  const { port, toolDeadlineMs } = serverSettings(engine.settings);
  const doors = openDoors(engine, state);
  // The cursor key derives from the token, handed over as a value, so a cursor this server issued outlives a restart.
  useCursorToken(doors.token);
  // Fail at start, not at the first call, when the database has no default org.
  await openOrgId(engine.store.sql);
  const publicOrigin = environment("LOUVAIN_ENGINE_PUBLIC_ORIGIN")?.trim() || undefined;
  const { token, door } = doors;
  const surfaces = plugins.list("surface");
  const server = await serve({ port, toolDeadlineMs, token, door, publicOrigin }, surfaces, {
    tools: () => toolList(engine),
    tool: openTools(engine),
    counts: () => loadedCounts(engine.store.sql),
    answerer: plugins.one("answerer"),
  });
  sayWhere(port, doors, surfaces);
  return server;
}

function openDoors(engine: ServedEngine, state: string): Doors {
  try {
    const { token, from } = engineToken({
      env: environment("LOUVAIN_ENGINE_TOKEN"),
      file: join(state, "token"),
    });
    return { token, from, door: ingestDoor(engine, token) };
  } catch (err) {
    const unreadable = err instanceof Error && "code" in err;
    if (!(err instanceof EngineTokenRefused || err instanceof IngestDoorRefused || unreadable))
      throw err;
    throw new ServerRefused(`Louvain Engine did not start. ${err.message}`);
  }
}

/**
 * Where the server is, its token, and each surface a person opens in a browser: one whose first route anyone may
 * fetch, at that route's path.
 */
function sayWhere(port: number, doors: Doors, surfaces: readonly Started<"surface">[]): void {
  const base = `http://127.0.0.1:${port}`;
  const tokenAt =
    doors.from === "LOUVAIN_ENGINE_TOKEN"
      ? "the LOUVAIN_ENGINE_TOKEN setting"
      : relative(process.cwd(), doors.from);
  const mcp = surfaces.some((s) => s.plugin.routes.some((route) => route.path === "/mcp"));
  console.log(
    `Louvain Engine is listening at ${base}${mcp ? "/mcp" : ""}; its bearer token is in ${tokenAt}.`,
  );
  if (doors.door)
    console.log(`It takes items at ${base}/ingest, with the "${doors.door.name}" source's token.`);
  for (const { name, plugin } of surfaces) {
    const [first] = plugin.routes;
    if (first?.needs === "none" && first.method === "GET")
      console.log(`Its ${name} is at ${base}${first.path.replace(/\*$/, "")}`);
  }
}
