import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  fetchPublic,
  type Pin,
  pinFor,
  pinnedRequest,
  privateAddress,
  publicUrl,
  readCapped,
  type Transport,
} from "../src/index.js";

/**
 * Every refusal here is one a fetcher inside the deployment must make, and
 * each table row is a spelling somebody has used to walk past a check that
 * read only one form of the address.
 */

test("every private spelling in both families is refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    // CGNAT — `100.100.100.200` is a cloud metadata service. The web app's own
    // copy of this list did not refuse it.
    "100.100.100.200",
    "100.64.0.1",
    "192.88.99.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fdaa::1",
    "fec0::1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::7f00:1",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:db8::1",
    "fe80::1%lo0",
    "not an address",
  ])
    assert.equal(privateAddress(ip), true, ip);
});

test("public addresses in both families are allowed", () => {
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::5db8:d822"])
    assert.equal(privateAddress(ip), false, ip);
});

test("publicUrl: https, no credentials, no literal, no internal suffix", () => {
  assert.equal(publicUrl("https://www.reuters.com/business").ok, true);
  for (const [raw, reason] of [
    ["http://reuters.com/x", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["https://user:pass@reuters.com/", "credentials_in_url"],
    ["https://user@reuters.com/", "credentials_in_url"],
    ["https://169.254.169.254/latest/meta-data/", "private_address"],
    ["https://[::1]/", "private_address"],
    ["https://8.8.8.8/", "ip_literal"],
    ["https://db.internal/", "internal_host"],
    ["https://db.internal./", "internal_host"],
    ["https://localhost/", "internal_host"],
    ["not a url", "not_a_url"],
  ] as const) {
    const verdict = publicUrl(raw);
    assert.equal(verdict.ok, false, raw);
    if (!verdict.ok) assert.equal(verdict.reason, reason, raw);
  }
});

test("publicUrl: a single label, Fly's private names and trailing dots are internal", () => {
  for (const raw of [
    "https://intranet/",
    "https://api.flycast/",
    "https://db.internal../",
    "https://localhost./",
  ])
    assert.deepEqual(publicUrl(raw), { ok: false, reason: "internal_host" }, raw);
  assert.equal(
    publicUrl("https://example.com./").ok,
    true,
    "one trailing dot on a public name is fine",
  );
});

test("publicUrl: a port policy refuses every port it does not name", () => {
  assert.equal(publicUrl("https://example.com/", { ports: [443] }).ok, true);
  assert.equal(publicUrl("https://example.com:443/", { ports: [443] }).ok, true);
  const odd = publicUrl("https://example.com:8443/", { ports: [443] });
  assert.equal(odd.ok, false);
  if (!odd.ok) assert.equal(odd.reason, "port_not_allowed");
  // No policy keeps the structured sources' behaviour: a pasted site may name its port.
  assert.equal(publicUrl("https://jira.example.com:8443/").ok, true);
});

test("pinFor: any private address refuses the name; the first public one is the pin", () => {
  assert.deepEqual(pinFor([]), { ok: false, reason: "unresolvable" });
  assert.deepEqual(pinFor([{ address: "93.184.216.34" }, { address: "127.0.0.1" }]), {
    ok: false,
    reason: "private_address",
  });
  assert.deepEqual(pinFor([{ address: "2606:4700::1" }]), {
    ok: true,
    pin: { address: "2606:4700::1", family: 6 },
  });
});

/** A transport that records what it was asked to connect to, answering from a table by URL. */
function recording(routes: Record<string, () => Response>): {
  transport: Transport;
  calls: { url: string; pin: Pin }[];
} {
  const calls: { url: string; pin: Pin }[] = [];
  return {
    calls,
    transport: async (url, _init, pin) => {
      calls.push({ url: url.toString(), pin });
      const route = routes[url.toString()];
      if (!route) throw new Error(`no route for ${url}`);
      return route();
    },
  };
}

const signal = () => AbortSignal.timeout(5_000);

test("fetchPublic connects to the address it CHECKED, even when the name answers differently later", async () => {
  // A rebinding name: public to the first question, the metadata service after.
  let asked = 0;
  const resolve = async () => {
    asked++;
    return [{ address: asked === 1 ? "93.184.216.34" : "169.254.169.254" }];
  };
  const { transport, calls } = recording({
    "https://rebind.example/": () => new Response("<html>ok</html>", { status: 200 }),
  });
  const result = await fetchPublic("https://rebind.example/", {
    accept: "text/html",
    signal: signal(),
    resolve,
    transport,
  });
  assert.equal(result.ok, true);
  assert.equal(asked, 1, "the name is resolved once per hop, by the check");
  assert.deepEqual(calls, [
    { url: "https://rebind.example/", pin: { address: "93.184.216.34", family: 4 } },
  ]);
});

test("fetchPublic vets every redirect hop and refuses one into the network", async () => {
  const resolve = async (host: string) =>
    host === "inside.example" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }];
  const { transport, calls } = recording({
    "https://public.example/": () =>
      new Response(null, { status: 302, headers: { location: "https://inside.example/secret" } }),
  });
  const result = await fetchPublic("https://public.example/", {
    accept: "text/html",
    signal: signal(),
    resolve,
    transport,
  });
  assert.deepEqual(result, { ok: false, reason: "private_address" });
  assert.equal(calls.length, 1, "the private hop is never connected to");

  const downgrade = recording({
    "https://public.example/": () =>
      new Response(null, { status: 301, headers: { location: "http://public.example/" } }),
  });
  assert.deepEqual(
    await fetchPublic("https://public.example/", {
      accept: "text/html",
      signal: signal(),
      resolve,
      transport: downgrade.transport,
    }),
    { ok: false, reason: "not_https" },
  );

  const port = recording({
    "https://public.example/": () =>
      new Response(null, { status: 302, headers: { location: "https://public.example:8443/" } }),
  });
  assert.deepEqual(
    await fetchPublic("https://public.example/", {
      accept: "text/html",
      signal: signal(),
      resolve,
      transport: port.transport,
    }),
    { ok: false, reason: "port_not_allowed" },
  );
});

test("fetchPublic stops at the redirect limit and reports a failing status", async () => {
  const resolve = async () => [{ address: "93.184.216.34" }];
  const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
  const loop = recording({
    "https://a.example/0": hop("https://a.example/1"),
    "https://a.example/1": hop("https://a.example/2"),
    "https://a.example/2": hop("https://a.example/3"),
    "https://a.example/3": hop("https://a.example/4"),
  });
  assert.deepEqual(
    await fetchPublic("https://a.example/0", {
      accept: "*/*",
      signal: signal(),
      resolve,
      transport: loop.transport,
    }),
    { ok: false, reason: "too_many_redirects" },
  );
  const missing = recording({ "https://a.example/": () => new Response("no", { status: 404 }) });
  assert.deepEqual(
    await fetchPublic("https://a.example/", {
      accept: "*/*",
      signal: signal(),
      resolve,
      transport: missing.transport,
    }),
    { ok: false, reason: "status", status: 404 },
  );
});

test("fetchPublic sends a previous response's validators, and only those, and reads a 304", async () => {
  const resolve = async () => [{ address: "93.184.216.34" }];
  const seen: Record<string, string>[] = [];
  const transport: Transport = async (_url, init) => {
    seen.push(init.headers);
    return new Response(null, { status: 304 });
  };
  assert.deepEqual(
    await fetchPublic("https://a.example/page", {
      accept: "text/html",
      signal: signal(),
      resolve,
      transport,
      conditional: { etag: '"v1"', lastModified: "Wed, 24 Sep 2026 10:00:00 GMT" },
    }),
    { ok: false, reason: "not_modified", status: 304 },
  );
  assert.deepEqual(seen[0], {
    accept: "text/html",
    "user-agent": "node",
    "accept-encoding": "identity",
    "if-none-match": '"v1"',
    "if-modified-since": "Wed, 24 Sep 2026 10:00:00 GMT",
  });
  // A validator carrying a line break is dropped, never sent: no header rides in on one.
  await fetchPublic("https://a.example/page", {
    accept: "text/html",
    signal: signal(),
    resolve,
    transport,
    conditional: { etag: '"v1"\r\ncookie: stolen=1', lastModified: null },
  });
  assert.deepEqual(Object.keys(seen[1] ?? {}).sort(), ["accept", "accept-encoding", "user-agent"]);
});

test("readCapped stops at the cap and says whether the body ended", async () => {
  const small = await readCapped(new Response("hello"), 100);
  assert.equal(new TextDecoder().decode(small.bytes), "hello");
  assert.equal(small.complete, true);

  const big = await readCapped(new Response("x".repeat(5_000)), 100);
  assert.equal(big.bytes.byteLength, 100);
  assert.equal(big.complete, false);

  const exact = await readCapped(new Response("x".repeat(100)), 100);
  assert.equal(exact.complete, true);

  // A body that streams for ever is still cut at the cap.
  let pulls = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1024));
    },
  });
  const cut = await readCapped(new Response(endless), 10_000);
  assert.equal(cut.bytes.byteLength, 10_000);
  assert.equal(cut.complete, false);
  assert.ok(pulls < 20, `read ${pulls} chunks for a 10 KB cap`);

  const declared = await readCapped(
    new Response("tiny", { headers: { "content-length": "999999999" } }),
    100,
  );
  assert.deepEqual(declared, { bytes: new Uint8Array(0), complete: false });
});

test("pinnedRequest reaches the pinned address, whatever the hostname resolves to", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`host=${req.headers.host}`);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  try {
    // `.invalid` never resolves (RFC 6761): only the pin can have connected this.
    const response = await pinnedRequest(
      new URL(`http://pinned.invalid:${port}/`),
      { method: "GET", headers: {}, signal: signal() },
      { address: "127.0.0.1", family: 4 },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `host=pinned.invalid:${port}`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("ipKind reads an address as node:net's isIP does, never more loosely, so the browser-safe check is the same check", async () => {
  const { isIP } = await import("node:net");
  const { ipKind } = await import("../src/address.js");
  for (const ip of [
    "127.0.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "256.1.1.1",
    "01.2.3.4",
    "127.1",
    "0x7f.0.0.1",
    "0x7f000001",
    "2130706433",
    "1.2.3",
    "1.2.3.4.5",
    " 1.2.3.4",
    "::",
    "::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "fe80::1%lo0",
    "fe80::1%",
    "2001:db8::1::1",
    "2001:db8:0:0:0:0:0:0:1",
    "[::1]",
    "::ffff:127.1",
    "::ffff:256.0.0.1",
    // Loose v4 tails ipaddr's parser would read (as 177.0.0.1, 1.2.3.4, 127.0.0.1): refused, as isIP refuses them.
    "::ffff:0177.0.0.1",
    "::ffff:01.2.3.4",
    "2606:4700::0x7f.0.0.1",
    "::0177.0.0.1",
    "64:ff9b::0177.0.0.1",
    "2606:4700::10.0.0.01",
    "gggg::1",
    "",
    "localhost",
  ])
    assert.equal(ipKind(ip), isIP(ip), JSON.stringify(ip));
});
