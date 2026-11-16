import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A browser signs in once, with a reader's token: posted once, matched in constant time (`readers.ts`), exchanged for
 * an httpOnly, SameSite=Strict cookie named for this server (a browser sends a loopback cookie to every port). The
 * server keeps which reader each sign-in reads as; the cookie carries a random id and never the reader. A sign-in lives
 * only while the server holds it (sign-out revokes it; a restart signs every browser out). Only the hosts the server is
 * reached at are answered (DNS rebinding), and no `X-Forwarded-*` is trusted: `Secure` follows the configured public
 * origin, never a request.
 */

const LIFETIME_S = 7 * 24 * 60 * 60;

/** Where browsers reach this server: its port on loopback, and the public origin of a proxy in front, if any. */
export type Door = { port: number; publicOrigin?: string | undefined };

const sign = (key: Buffer, body: string): string =>
  createHmac("sha256", key).update(body).digest("base64url");

/** This server's cookie and where it is reached: a key from the token, a name from the key and the port. */
function doorOf(token: string, door: Door) {
  const key = createHmac("sha256", token).update("louvain-engine browser session").digest();
  const secure = door.publicOrigin?.startsWith("https://") === true;
  const name = `${secure ? "__Host-" : ""}louvain_engine_${sign(key, `cookie ${door.port}`).slice(0, 12)}`;
  const origins = new Set([
    `http://127.0.0.1:${door.port}`,
    `http://localhost:${door.port}`,
    `http://[::1]:${door.port}`,
    ...(door.publicOrigin ? [new URL(door.publicOrigin).origin] : []),
  ]);
  const hosts = new Set([...origins].map((origin) => new URL(origin).host));
  const attributes = `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  return { key, name, origins, hosts, attributes };
}

type Doors = ReturnType<typeof doorOf>;

/** The live sign-in a request carries: its signature holds, it has not expired, and it was not signed out. */
function liveSignIn(d: Doors, live: ReadonlyMap<string, string>, headers: Headers): string | null {
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${d.name}=`))
    ?.slice(d.name.length + 1);
  const [issued, id, mac] = cookie?.split(".") ?? [];
  if (!issued || !id || !mac || !live.has(id)) return null;
  const expected = Buffer.from(sign(d.key, `${issued}.${id}`));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const age = Date.now() / 1000 - Number(issued);
  return age >= 0 && age < LIFETIME_S ? id : null;
}

export type BrowserSessions = ReturnType<typeof browserSessions>;

export function browserSessions(token: string, door: Door) {
  const d = doorOf(token, door);
  // Each live sign-in's id, and the reader it reads as.
  const live = new Map<string, string>();
  const of = (headers: Headers) => liveSignIn(d, live, headers);
  const nameOf = (id: string) =>
    `browser ${createHash("sha256").update(id).digest("base64url").slice(0, 16)}`;
  return {
    /** A request for a host this server is not reached at is refused before anything reads it. */
    knownHost: (headers: Headers) => d.hosts.has(headers.get("host") ?? ""),
    /** A change must come from a page this server served: same-origin, or an Origin of this server's. */
    sameOrigin: (headers: Headers) =>
      headers.get("sec-fetch-site") === "same-origin" || d.origins.has(headers.get("origin") ?? ""),
    /** Who a live sign-in reads as: a name derived from it, never the cookie, and its reader; or null for none. */
    reader(headers: Headers): { name: string; principal: string } | null {
      const id = of(headers);
      if (id === null) return null;
      const principal = live.get(id);
      return principal === undefined ? null : { name: nameOf(id), principal };
    },
    /** A new sign-in, reading as `principal`: the cookie that carries it. */
    signIn(principal: string, now = Date.now()): string {
      const id = randomBytes(16).toString("base64url");
      live.set(id, principal);
      const body = `${Math.floor(now / 1000)}.${id}`;
      return `${d.name}=${body}.${sign(d.key, body)}; Max-Age=${LIFETIME_S}; ${d.attributes}`;
    },
    /** Ends the sign-in this reader name was derived from (`reader`), and clears the cookie. */
    signOut(reader: string): string {
      for (const id of live.keys()) if (nameOf(id) === reader) live.delete(id);
      return `${d.name}=; Max-Age=0; ${d.attributes}`;
    },
  };
}

/**
 * What every answer the server sends carries: no framing, no script but the server's own files, no
 * request to any other host, nothing sniffed, nothing referred.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
