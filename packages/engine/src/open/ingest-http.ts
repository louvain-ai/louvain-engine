import { firstMalformedTextPath, type PluginRegistry } from "@louvain/engine-core";
import type { Writes } from "../writes.js";
import { IngestRefused } from "./ingest/ownership.js";
import { ingestFrom } from "./ingest/run.js";
import type { ItemOutcome } from "./ingest/summary.js";
import { doorSources, IngestSourceRefused, openSource } from "./ingest-sources/index.js";

/**
 * POST /ingest: a batch of items into a collection, answered item by item. It is off unless `engine.config.ts` names a
 * source with a door (`http({ token })`), whose token the server checks before the body is read. It never reads a file
 * an item names: a caller's say-so never reaches the server's disk. One ingest runs at a time and another is told to
 * come back (429).
 */

/** The most a request body may be. */
export const INGEST_MAX_BODY_BYTES = 8 * 1024 * 1024;

export type IngestReply = { status: number; body: unknown };

export class IngestDoorRefused extends Error {}

/** The configured door: the source it opens and its token, and the engine's plugins and writes it ingests with. */
export type IngestDoor = { plugins: PluginRegistry; writes: Writes; name: string; token: string };

/**
 * The engine's door, or null when no configured source has one; two doors, or one opened with the read token, refuse
 * the start.
 */
export function ingestDoor(
  engine: { readonly plugins: PluginRegistry; readonly writes: Writes },
  readToken: string,
): IngestDoor | null {
  const { plugins, writes } = engine;
  const [door, ...more] = doorSources(plugins);
  if (!door) return null;
  if (more.length > 0)
    throw new IngestDoorRefused(
      `engine.config.ts opens ${more.length + 1} ingest doors (${[door, ...more].map((d) => d.name).join(", ")}); the server has one.`,
    );
  if (door.token === readToken)
    throw new IngestDoorRefused(
      `the "${door.name}" source's token is the read token, which agents hold: give the door its own secret.`,
    );
  return { plugins, writes, ...door };
}

let running = false;

export async function answerIngest(door: IngestDoor, body: string): Promise<IngestReply> {
  if (running)
    return refusal(429, "busy", "Another ingest is running. Send this again when it has finished.");
  running = true;
  try {
    return await ingest(door, body);
  } finally {
    running = false;
  }
}

async function ingest(door: IngestDoor, body: string): Promise<IngestReply> {
  let request: unknown;
  try {
    request = JSON.parse(body);
  } catch {
    // swallowed: the caller is told the body is not JSON; nothing of it is echoed.
    return refusal(400, "invalid_json", "The body is not JSON.");
  }
  const unstorable = firstMalformedTextPath(request);
  if (unstorable)
    return refusal(
      400,
      "invalid_text",
      `${unstorable.join(".")} holds a broken character or a NUL, which cannot be stored.`,
    );
  const items: ItemOutcome[] = [];
  const host = {
    source: door.name,
    files: null,
    lane: null,
    removals: "keep" as const,
    takeOver: false,
    removeMany: false,
  };
  try {
    const summary = await ingestFrom(door.writes, openSource(door.plugins, door.name, request), {
      ...host,
      onItem: (o) => items.push(o),
    });
    return {
      status: 200,
      body: { collection: summary.collection, changed: summary.changed, items },
    };
  } catch (err) {
    if (err instanceof IngestSourceRefused || err instanceof IngestRefused)
      return refusal(400, "invalid_request", err.message);
    throw err;
  }
}

const refusal = (status: number, error: string, message: string): IngestReply => ({
  status,
  body: { error, message },
});
