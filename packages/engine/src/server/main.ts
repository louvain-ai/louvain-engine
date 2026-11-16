/**
 * The tool server's start: from the state directory it is handed, the engine's own token and every named reader's;
 * the ingest door its configuration opens; the cursor key from the engine's token; the default org checked; then
 * `serve()` with the configured surfaces and the engine's reading (its tools, its counts, its answerer), bound per
 * request to the reader a token names, and where everything is said. A token it may not read, or a door set wrong, is
 * a `ServerRefused` in one sentence, never a stack trace.
 */
import type { Server } from "node:http";
import { join, relative } from "node:path";
import type { Started } from "@louvain/engine-core";
import { environment } from "../config/environment.js";
import { serverSettings } from "../config/standalone.js";
import type { Engine } from "../engine.js";
import { hooksOf } from "../read/hooks.js";
import { workspaceIdOf } from "../store/tenant.js";
import { type IngestDoor, IngestDoorRefused, ingestDoor } from "./ingest-route.js";
import { type Readers, readersOf } from "./readers.js";
import { openReading } from "./reading.js";
import { serve } from "./serve.js";
import { EngineTokenRefused, engineToken } from "./token.js";
import type { ToolEngine } from "./tools/run.js";

/** A server that cannot start, in the sentence that says why. */
export class ServerRefused extends Error {}

/** The server's doors: the engine's own token and every reader's, and the source POST /ingest opens, if any. */
type Doors = { token: string; from: string; readers: Readers; door: IngestDoor | null };

/** What the server runs on: the engine's reads, its plugins, its store and its writes (the ingest door's). */
export type ServedEngine = ToolEngine & Pick<Engine, "writes">;

/** The tool server for this engine, its token kept in `state` (the install's `.engine/`, or a profile's). */
export async function startToolServer(engine: ServedEngine, state: string): Promise<Server> {
  const { plugins } = engine;
  const { port, toolDeadlineMs } = serverSettings(engine.settings);
  const doors = openDoors(engine, state);
  // The engine's cursors are sealed under a key its token makes, so a cursor this server issued outlives a restart.
  hooksOf(engine.context).presentation.keyCursorsFrom?.(doors.token);
  // Fail at start, not at the first call, when the database has no default org.
  await workspaceIdOf(engine.store.sql);
  const publicOrigin = environment("LOUVAIN_ENGINE_PUBLIC_ORIGIN")?.trim() || undefined;
  const { token, readers, door } = doors;
  const surfaces = plugins.list("surface");
  const settings = { port, toolDeadlineMs, token, readers, door, publicOrigin };
  const server = await serve(settings, surfaces, openReading(engine));
  sayWhere(port, doors, surfaces);
  return server;
}

function openDoors(engine: ServedEngine, state: string): Doors {
  try {
    const { token, from } = engineToken({
      env: environment("LOUVAIN_ENGINE_TOKEN"),
      file: join(state, "token"),
    });
    const readers = readersOf(state, token);
    return { token, from, readers, door: ingestDoor(engine, readers) };
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
  const named = doors.readers.named;
  if (named.length > 0)
    console.log(
      `It also reads as ${named.join(", ")}, each with a token of its own (./engine reader list).`,
    );
  if (doors.door)
    console.log(`It takes items at ${base}/ingest, with the "${doors.door.name}" source's token.`);
  for (const { name, plugin } of surfaces) {
    const [first] = plugin.routes;
    if (first?.needs === "none" && first.method === "GET")
      console.log(`Its ${name} is at ${base}${first.path.replace(/\*$/, "")}`);
  }
}
