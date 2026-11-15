import { createHmac, randomBytes } from "node:crypto";

/**
 * The cursor key: an HMAC-SHA256 of the engine's bearer token under a label of its own, so a cursor one
 * engine sealed opens on that engine after a restart and on no other, and the token itself never keys anything. With no
 * token configured, a random key for this process: cursors then last as long as the process does.
 */
const CURSOR_LABEL = "louvain-engine:search-cursor";

let processKey: Buffer | undefined;

let serverToken: string | undefined;

/** The server's token, handed over once at its start (never through the environment), so its cursors outlive a restart. */
export function useCursorToken(token: string | undefined): void {
  serverToken = token;
}

export function engineCursorKey(token = serverToken): Buffer {
  if (token) return createHmac("sha256", token).update(CURSOR_LABEL).digest();
  processKey ??= randomBytes(32);
  return processKey;
}
