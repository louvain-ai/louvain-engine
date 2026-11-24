/**
 * The first read of a reader pg_rebac was never asked about: rebacd's `POST /lookup` asks SpiceDB and writes the
 * answer down, an empty one included. Anything but a written answer is unavailable, never a guess.
 */
import { PermissionsUnavailable } from "./refusals.js";

/** Asks rebacd at `url` to project one reader in one `tenant`; resolves once the answer is written down. */
export type Lookup = (tenant: string, principal: string) => Promise<void>;

export const lookupAt =
  (url: string, timeoutMs: number): Lookup =>
  async (tenant, principal) => {
    const answer = await fetch(new URL("/lookup", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant, principal }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((err: unknown) => {
      throw new PermissionsUnavailable("rebacd could not be reached to look the reader up", {
        cause: err,
      });
    });
    await answer.body?.cancel();
    if (!answer.ok)
      throw new PermissionsUnavailable(`rebacd could not look the reader up (${answer.status})`);
  };
