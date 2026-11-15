/**
 * The engine's own server settings: the tool server's port and reply deadline, and the bounds every file reader runs
 * inside. The port and the bounds are read from the environment here and nowhere else, and a value that is not one
 * refuses the start, naming it; the reply deadline is the configuration's (`settings.server.toolDeadlineMs`).
 */
import { environment } from "./environment.js";
import { settings } from "./settings.js";

/** Bytes, characters and milliseconds a file read may take (`file-readers/bounded.ts`), read once at load. */
export const fileReadLimits = {
  maxBytes: environment("LOUVAIN_FILE_MAX_BYTES"),
  maxChars: environment("LOUVAIN_FILE_MAX_CHARS"),
  deadlineMs: environment("LOUVAIN_FILE_READ_DEADLINE_MS"),
};

/** The tool server's port (a whole number from 1 to 65535) and how long a tool call's reply may take. */
export function serverSettings(): { port: number; toolDeadlineMs: number } {
  const port = environment("LOUVAIN_ENGINE_PORT");
  if (!Number.isInteger(port) || port > 65_535)
    throw new Error(
      `LOUVAIN_ENGINE_PORT must be a port number from 1 to 65535, got "${process.env.LOUVAIN_ENGINE_PORT}"`,
    );
  return { port, toolDeadlineMs: settings().server.toolDeadlineMs };
}
