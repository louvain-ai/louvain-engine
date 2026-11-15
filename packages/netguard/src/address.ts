import ipaddr from "ipaddr.js";

/**
 * WHICH ADDRESSES A REQUEST FROM INSIDE THE DEPLOYMENT MAY REACH — pure, with
 * no database or configuration import, so every process that fetches on
 * someone else's say-so uses exactly the same rule: the API's assistant web
 * tools (a URL a model chose), the structured-source runners (a URL an
 * administrator typed, and a runner's environment carries no database URL),
 * and the WEB app's server-side fetchers (`/unfurl`, `/site-image`,
 * `/site-icon` — a host a cited page named).
 *
 * ONE PACKAGE, NOT A COPY PER APP. The web app used to carry its own, and it
 * was the weaker one: it did not refuse CGNAT (`100.100.100.200` is a cloud
 * metadata service), the retired 6to4 relay, NAT64, 6to4 or site-local v6 —
 * and the web app's fetchers need no session, so it was the one any internet
 * user could point. A second, slightly different definition of "private" is
 * how one caller acquires a hole the others do not have.
 */

/**
 * IS THIS ADDRESS ONE THE INTERNET CAN REACH?
 *
 * Everything a fetch must refuse, in both address families, because the whole
 * point of the fetch is that it is made by a process sitting inside the
 * deployment's own network: the loopback interface (the API's own routes),
 * RFC1918 and CGNAT space (Postgres, SpiceDB, the broker's dashboard),
 * link-local (`169.254.169.254`, the cloud metadata service that hands out
 * credentials), multicast, the unspecified address, and the special-purpose
 * blocks nothing on the public web is served from (benchmarking, protocol
 * assignments, documentation, the reserved top of the space).
 *
 * A v6 address that CARRIES a v4 one is decided by the v4 half, in every
 * spelling: IPv4-mapped (`::ffff:10.0.0.1`, and its hex form `::ffff:a00:1`),
 * IPv4-compatible (`::7f00:1`), IPv4-translated (`::ffff:0:a00:1`), NAT64
 * (`64:ff9b::a9fe:a9fe` reaches the metadata service through the gateway) and
 * 6to4 (`2002:a9fe:a9fe::`). A check that reads only the v6 form of any of
 * them is a check that passes. Beyond those, only GLOBAL UNICAST (`2000::/3`)
 * is public — an allowlist, because the v6 blocks that are not the internet
 * (unique-local, link-local, site-local `fec0::/10`, discard-only, multicast,
 * the unassigned rest) outnumber the one block that is.
 */
/**
 * WHICH FAMILY A STRING IS AN ADDRESS OF: 4, 6, or 0 for none — `node:net`'s `isIP`, from `ipaddr.js` so this file
 * runs in a browser too (`@louvain/netguard/address`: the web's own check on a link a running page asks to open).
 * A v4 address is the four-part decimal form only, as `isIP` takes it: `ipaddr`'s looser parser also reads `0x7f.1`
 * and `127.1`, which a URL has already normalised and a bare string must not be read as.
 *
 * Never looser than `isIP`, sometimes stricter: a zone id with a `.` or `-` (`fe80::1%eth0.1`) is 0 here and 6 there,
 * which only refuses what was refused anyway (a zone names a local interface).
 */
export function ipKind(ip: string): 0 | 4 | 6 {
  if (ipaddr.IPv4.isValidFourPartDecimal(ip)) return 4;
  if (!ipaddr.IPv6.isValid(ip)) return 0;
  // A dotted v4 tail is held to the same four-part decimal form: `ipaddr` reads `::ffff:0177.0.0.1` as 177.0.0.1,
  // where `isIP` refuses it, and a v6 address carrying a mis-read v4 would be judged by the wrong one.
  const bare = ip.split("%")[0] ?? "";
  if (
    bare.includes(".") &&
    !ipaddr.IPv4.isValidFourPartDecimal(bare.slice(bare.lastIndexOf(":") + 1))
  )
    return 0;
  return 6;
}

export function privateAddress(ip: string): boolean {
  const kind = ipKind(ip);
  if (kind === 0) return true; // not an address at all: refuse rather than guess
  if (kind === 4) return privateV4(ip);
  if (ip.includes("%")) return true; // a zone id names a local interface by definition
  const h = hextets(ip);
  if (!h) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const v4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeroHead = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0;
  // ::/96 compatible (with :: and ::1), ::ffff:0:0/96 mapped, ::ffff:0:0:0/96 translated.
  if (zeroHead && ((h4 === 0 && (h5 === 0 || h5 === 0xffff)) || (h4 === 0xffff && h5 === 0))) {
    return privateV4(v4(h6, h7));
  }
  // 64:ff9b::/96, the well-known NAT64 prefix: the gateway connects to the v4 half.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return privateV4(v4(h6, h7));
  }
  // 2002::/16, 6to4: the relay delivers to the v4 half.
  if (h0 === 0x2002) return privateV4(v4(h1, h2));
  // Only 2000::/3 is global unicast. The rest — 64:ff9b:1::/48 local NAT64, 100::/64,
  // fc00::/7, fe80::/10, fec0::/10, ff00::/8, the unassigned space — is not the internet.
  if ((h0 & 0xe000) !== 0x2000) return true;
  if (h0 === 0x2001 && h1 < 0x200) return true; // 2001::/23 protocol assignments, Teredo among them
  if (h0 === 0x2001 && h1 === 0xdb8) return true; // 2001:db8::/32 documentation
  if (h0 === 0x3fff && h1 < 0x1000) return true; // 3fff::/20 documentation
  return false;
}

/** The eight hextets of a v6 address, a trailing dotted v4 half included; null when it will not parse. */
function hextets(ip: string): number[] | null {
  try {
    return ipaddr.IPv6.parse(ip).parts;
  } catch {
    // swallowed: "not an address" is the answer, and the caller refuses it.
    return null;
  }
}

function privateV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this network, RFC1918, loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, and the metadata service
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // protocol assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // the retired 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved, up to 255.255.255.255
  return false;
}

/**
 * MAY THE PROCESS EVEN TRY THIS URL?
 *
 * Scheme and host only, before any resolution: HTTPS because a plaintext
 * fetch from inside the deployment's network is a request an intermediary can
 * rewrite into any other request, and because nothing on the public web that
 * is worth citing is http-only; a name that is an IP LITERAL because the only
 * reason to name an address rather than a host is to skip the name; and the
 * internal suffixes (`.internal` is Fly's own private DNS, `.local`/
 * `.localhost` the local ones) because those names resolve differently inside
 * the deployment than anywhere a search engine ran.
 *
 * Pure, and applied at every hop of a redirect chain as well as to the
 * original result — a search engine does not return private ranges, but the
 * page it returns can redirect wherever it likes.
 *
 * CREDENTIALS IN THE URL ARE REFUSED, never stripped: `https://user:pw@host`
 * sends an Authorization header nobody in the deployment chose, and a check
 * that quietly removes them has a log that no longer says what it was asked.
 *
 * `ports` narrows the port a caller may reach. A fetcher of PAGES passes
 * `[443]`: nothing worth citing is served on 8443, and "any port on a public
 * host" is a port scanner run from a trusted address — the redirect a result
 * can still be decides which port, and the answer only has to be "open". The
 * structured sources leave it open, because a tracker an administrator runs on
 * its own port is a real administrator's real URL.
 */
export type PublicUrlPolicy = {
  /** The ports a caller may reach; unset allows any. The scheme default (443) is `""` in a URL and counts as 443. */
  ports?: readonly number[];
};

export function publicUrl(
  input: string,
  policy: PublicUrlPolicy = {},
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // swallowed: "not a URL" is this function's answer, not a failure of it.
    return { ok: false, reason: "not_a_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  if (policy.ports && !policy.ports.includes(url.port === "" ? 443 : Number(url.port))) {
    return { ok: false, reason: "port_not_allowed" };
  }
  // Every trailing dot: `internal..` is `internal`, and a suffix check must see it.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (host.length === 0) return { ok: false, reason: "no_host" };
  // `new URL` keeps a v6 literal in its brackets; the address is what is inside.
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (ipKind(literal) !== 0) {
    return privateAddress(literal)
      ? { ok: false, reason: "private_address" }
      : { ok: false, reason: "ip_literal" };
  }
  // A single-label name is a search-domain lookup into whatever network the resolver sits in, and
  // `.flycast` is Fly's private service address: neither names anything on the public internet.
  if (
    host === "localhost" ||
    !host.includes(".") ||
    /\.(internal|local|localhost|flycast)$/.test(host)
  ) {
    return { ok: false, reason: "internal_host" };
  }
  return { ok: true, url };
}
