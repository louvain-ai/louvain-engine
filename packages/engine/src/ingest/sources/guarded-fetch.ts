import type { GuardedFetch } from "@louvain/engine-core";
import { fetchPublic, readCapped } from "@louvain/netguard";

/** The most a fetched body may be: as much as a file the engine reads. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * The fetch every source is handed (`@louvain/netguard`): HTTPS on port 443 to an address that resolves public, the
 * socket pinned to the address checked, each redirect checked again, no header but `accept`, and the body read as a
 * stream that stops at its bound. A source that reads a service names its URL; it never chooses where the request goes.
 */
export const guardedFetch: GuardedFetch = async (url, { accept, signal, maxBytes = MAX_BYTES }) => {
  const got = await fetchPublic(url, { accept, signal });
  if (!got.ok)
    return {
      ok: false,
      reason: got.reason,
      ...(got.status === undefined ? {} : { status: got.status }),
    };
  const bound = Math.min(maxBytes, MAX_BYTES);
  const { bytes, complete } = await readCapped(got.response, bound);
  return complete
    ? { ok: true, bytes, contentType: got.response.headers.get("content-type") }
    : { ok: false, reason: `the body is larger than ${bound} bytes` };
};
