import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { privateAddress, publicUrl } from "./address.js";

/**
 * Connect to the address that was checked.
 *
 * Checking a name's resolved addresses and then handing its URL to `fetch` is
 * two resolutions: the check's and the transport's. The owner of the name
 * answers both, and can answer differently the second time — a public address
 * to the check, `169.254.169.254` to the connection. That is DNS rebinding, and
 * with a short TTL it is not an exotic attack; it is a line in a zone file.
 *
 * So a vetted request carries a PIN — the one address the check approved — and
 * the transport's `lookup` answers with that address and nothing else. The TLS
 * handshake still names and verifies the HOST (the URL's hostname is the SNI
 * and the certificate subject), so a pinned connection is exactly as
 * authenticated as an unpinned one; only the address it may reach is fixed.
 */

/** The one address a request may connect to, chosen when its name was vetted. */
export type Pin = { address: string; family: 4 | 6 };

/** `dns.lookup` with `all: true` — injected so a test can answer without a network. */
export type Resolve = (host: string) => Promise<{ address: string; family?: number }[]>;

export const systemResolve: Resolve = (host) => lookup(host, { all: true });

/**
 * The resolved addresses of a name, judged. ANY private address refuses the
 * whole name: a host answering with one public address and one private one is
 * the rebinding case, and picking the public one is picking the answer the
 * attacker did not need.
 */
export function pinFor(
  addresses: readonly { address: string }[],
): { ok: true; pin: Pin } | { ok: false; reason: "unresolvable" | "private_address" } {
  const first = addresses[0];
  if (!first) return { ok: false, reason: "unresolvable" };
  if (addresses.some((a) => privateAddress(a.address)))
    return { ok: false, reason: "private_address" };
  return { ok: true, pin: { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 } };
}

export type PinnedInit = {
  method: string;
  headers: Record<string, string>;
  /** A string is sent as UTF-8; bytes (an encrypted push) as they are. */
  body?: string | Uint8Array;
  signal: AbortSignal;
};

/**
 * One request over Node's own `http`/`https`, whose `lookup` answers with the
 * pinned address. It never follows a redirect — a caller that follows them
 * does so by hand and vets each hop. The body is a stream, never buffered here.
 */
export function pinnedRequest(url: URL, init: PinnedInit, pin: Pin): Promise<Response> {
  const client = url.protocol === "https:" ? https : http;
  const pinned = ((_host, options, callback) => {
    if (options.all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  }) as LookupFunction;
  return new Promise<Response>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        lookup: pinned,
        /*
         * No shared agent. The global agent is where Node's environment proxy lives
         * (`NODE_USE_ENV_PROXY` / `--use-env-proxy` with `HTTPS_PROXY`): through it the request
         * goes to the PROXY, which resolves the name itself and never sees the pin. A private
         * agent per request also means no pooled socket from another host is ever reused.
         */
        agent: false,
      },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(name, v);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 502;
        const bodiless = status === 204 || status === 205 || status === 304;
        try {
          resolve(
            new Response(bodiless ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
              status,
              headers,
            }),
          );
        } catch (err) {
          // swallowed: not swallowed — handed to reject(); a status a Response cannot carry is a broken upstream
          res.destroy();
          reject(err);
        }
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.end(init.body);
    else req.end();
  });
}

/** What opens a vetted connection. The default is `pinnedRequest`; a test supplies canned responses. */
export type Transport = (url: URL, init: PinnedInit, pin: Pin) => Promise<Response>;

export type FetchPublicOptions = {
  accept: string;
  signal: AbortSignal;
  /** Default 3. */
  maxRedirects?: number;
  /** Default `[443]` — a fetcher of pages has no business on any other port. */
  ports?: readonly number[];
  resolve?: Resolve;
  transport?: Transport;
  userAgent?: string;
  /**
   * A conditional GET: the validators a previous response gave. They are the ONLY headers a caller
   * may add, and each is refused if it carries a line break, so no header can be smuggled through
   * them. A `304` then answers `{ ok: false, reason: "not_modified" }`.
   */
  conditional?: { etag?: string | null; lastModified?: string | null };
};

export type PublicFetch =
  | { ok: true; response: Response; url: URL }
  | {
      ok: false;
      reason: string;
      status?: number;
      /**
       * The refusing response's `Retry-After`, as sent (one line, bounded, else absent), so a caller that waits out a
       * 429/503 can read it. Never followed or acted on here.
       */
      retryAfter?: string;
    };

const oneLine = (v: string | null | undefined): string | null =>
  v && v.length <= 512 && !/[\r\n\0]/.test(v) ? v : null;

/** `If-None-Match` / `If-Modified-Since` from a previous response's validators, when they are safe. */
function validators(conditional: FetchPublicOptions["conditional"]): Record<string, string> {
  if (!conditional) return {};
  const etag = oneLine(conditional.etag);
  const since = oneLine(conditional.lastModified);
  return {
    ...(etag ? { "if-none-match": etag } : {}),
    ...(since ? { "if-modified-since": since } : {}),
  };
}

/**
 * Fetch a URL somebody else chose, safely — the whole policy in one call.
 *
 * Every hop gets all of it: `publicUrl` over the URL (https, no credentials,
 * no address literal, no internal suffix, the allowed ports), every resolved
 * address public, and a connection PINNED to the address that passed.
 * Redirects are followed by hand so a public host that 302s into the network
 * is refused one hop later rather than obeyed, and never more than
 * `maxRedirects` of them. A non-2xx final response is a refusal with its
 * status; the body of a success is left as a stream for the caller to read
 * under a byte cap (`readCapped`).
 */
export async function fetchPublic(raw: string, options: FetchPublicOptions): Promise<PublicFetch> {
  return vettedGet(raw, options);
}

/**
 * The hop loop every vetted GET shares (`fetchPublic`, and any media fetch built on it), so the two cannot drift apart:
 * each hop is `publicUrl`, the caller's own host test (`admits`, a media fetch's allowlist), every resolved address
 * public, a socket pinned to the address that passed, and a redirect followed by hand. A caller adds NO header of
 * its own: it names what it needs — the conditional validators (each one line, `oneLine`) or a byte range (two safe
 * integers, built here) — so no caller can send a cookie or `Authorization`, or change `accept-encoding`.
 * Not exported from the package: a new caller is a new rule, written beside these (`media.ts`, `preview.ts`).
 */
export async function vettedGet(
  raw: string,
  options: FetchPublicOptions & {
    /** One byte range, inclusive, as two checked integers: sent as `range: bytes=start-end`, never as a string. */
    range?: { start: number; end: number };
    /** Refuse a hop whose URL this caller does not name (`not_allowed`), before its host is resolved. */
    admits?: (url: URL) => boolean;
  },
): Promise<PublicFetch> {
  const range = options.range;
  if (
    range &&
    !(
      Number.isSafeInteger(range.start) &&
      Number.isSafeInteger(range.end) &&
      range.start >= 0 &&
      range.end >= range.start
    )
  )
    return { ok: false, reason: "bad_range" };
  const resolve = options.resolve ?? systemResolve;
  const transport = options.transport ?? pinnedRequest;
  const maxRedirects = options.maxRedirects ?? 3;
  const ports = options.ports ?? [443];
  let target = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = publicUrl(target, { ports });
    if (!checked.ok) return { ok: false, reason: checked.reason };
    if (options.admits && !options.admits(checked.url)) return { ok: false, reason: "not_allowed" };
    let addresses: { address: string }[];
    try {
      addresses = await resolve(checked.url.hostname);
    } catch {
      // swallowed: a name that will not resolve is this fetch's refusal, not an error to raise.
      return { ok: false, reason: "unresolvable" };
    }
    const pinned = pinFor(addresses);
    if (!pinned.ok) return { ok: false, reason: pinned.reason };
    let response: Response;
    try {
      response = await transport(
        checked.url,
        {
          method: "GET",
          headers: {
            accept: options.accept,
            // `fetch` sends one and some hosts refuse a request without it; a
            // pinned request is Node's `http`, which sends none of its own.
            "user-agent": options.userAgent ?? "node",
            // Said, not assumed: a compressed body would be measured by `readCapped` compressed.
            "accept-encoding": "identity",
            ...validators(options.conditional),
            ...(range ? { range: `bytes=${range.start}-${range.end}` } : {}),
          },
          signal: options.signal,
        },
        pinned.pin,
      );
    } catch {
      // swallowed: a connection that fails is "unreachable", and its message can quote the URL.
      return { ok: false, reason: "unreachable" };
    }
    if (response.status === 304 && options.conditional) {
      await response.body?.cancel().catch(() => {
        // swallowed: a 304 carries no body worth reading.
      });
      return { ok: false, reason: "not_modified", status: 304 };
    }
    if (response.status >= 300 && response.status < 400) {
      // The redirect's own body is never read; release the socket.
      await response.body?.cancel().catch(() => {
        // swallowed: cancelling a body nobody will read is best effort.
      });
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "redirect_without_location" };
      if (hop === maxRedirects) return { ok: false, reason: "too_many_redirects" };
      try {
        target = new URL(location, checked.url).toString();
      } catch {
        // swallowed: an unparseable Location is a refusal of this fetch.
        return { ok: false, reason: "not_a_url" };
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {
        // swallowed: the refusal is the status; its body is not wanted.
      });
      const retryAfter = oneLine(response.headers.get("retry-after"));
      return {
        ok: false,
        reason: "status",
        status: response.status,
        ...(retryAfter ? { retryAfter } : {}),
      };
    }
    return { ok: true, response, url: checked.url };
  }
  return { ok: false, reason: "too_many_redirects" };
}

/**
 * A body read as a stream and stopped at the cap. `response.text()` and
 * `arrayBuffer()` buffer whatever the far end chose to send before anything
 * can measure it, and a host somebody else named is allowed to be hostile
 * about its own size. A declared `content-length` over the cap is refused
 * before a byte is read. `complete` says whether the body ENDED within the cap:
 * a caller that wants a whole file (an image) refuses an incomplete one, and a
 * caller that wants the head of a page (an HTML `<head>`) uses what it got.
 */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; complete: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(0), complete: true };
  if (Number.isFinite(declared) && declared > maxBytes) {
    await body.cancel().catch(() => {
      // swallowed: the body is refused by its declared size; cancelling it is best effort.
    });
    return { bytes: new Uint8Array(0), complete: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (!value) continue;
      const room = maxBytes - seen;
      if (value.byteLength > room) {
        if (room > 0) chunks.push(value.subarray(0, room));
        seen = maxBytes;
        break;
      }
      chunks.push(value);
      seen += value.byteLength;
    }
  } finally {
    // A read cut at the cap leaves the connection open otherwise.
    await reader.cancel().catch(() => {
      // swallowed: cancelling a body already cut at the byte cap is best effort.
    });
  }
  const bytes = new Uint8Array(seen);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes, complete };
}
