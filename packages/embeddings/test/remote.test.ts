import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { RemoteFailure } from "../src/remote.js";
import { remoteOf, vectorsFor, withFetch } from "./helpers.js";

/**
 * THE REMOTE CLIENT, ONE PER EMBEDDER: request batches keep their lane and order; a bulk request that never connected
 * is tried again before it is a failure, a query never is; each lane has its own limit; every failure reaches the
 * embedder's observer with a bounded reason; fallback is opt-in; the bearer rides on every request; `/count` is the
 * bulk sidecar's own tokenizer. Stub `fetch` or a local server, no clock.
 */
const LANES = {
  LOUVAIN_EMBEDDINGS_URL: "http://query.invalid",
  LOUVAIN_EMBEDDINGS_BULK_URL: "http://bulk.invalid",
  LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK: "false",
};

test("batches keep their lane and order, and a request batch of one sends one text a request", async () => {
  const texts = Array.from({ length: 19 }, (_, n) => String(n));
  await withFetch(
    (_url, init) => vectorsFor(init),
    async (calls) => {
      const remote = remoteOf({ ...LANES, LOUVAIN_EMBEDDINGS_REQUEST_BATCH: "8" });
      assert.deepEqual(
        await remote.remoteEmbed(texts, "interactive"),
        texts.map((t) => [Number(t)]),
      );
      const bodies = calls.map(
        (c) => JSON.parse(String(c.init?.body)) as { texts: string[]; lane: string },
      );
      assert.deepEqual(
        bodies.map((b) => b.texts.length),
        [8, 8, 3],
      );
      assert.ok(bodies.every((b) => b.lane === "interactive"));
      assert.ok(calls.every((c) => c.url === "http://query.invalid/embed"));
      calls.length = 0;
      const single = remoteOf({ ...LANES, LOUVAIN_EMBEDDINGS_REQUEST_BATCH: "1" });
      assert.deepEqual(await single.remoteEmbed(["1", "2"], "bulk"), [[1], [2]]);
      assert.deepEqual(
        calls.map((c) => c.url),
        ["http://bulk.invalid/embed", "http://bulk.invalid/embed"],
      );
    },
  );
});

test("a request batch above 256 is held at 256", async () => {
  await withFetch(
    (_url, init) => vectorsFor(init),
    async (calls) => {
      const remote = remoteOf({ ...LANES, LOUVAIN_EMBEDDINGS_REQUEST_BATCH: "1000" });
      await remote.remoteEmbed(
        Array.from({ length: 300 }, (_, n) => String(n)),
        "bulk",
      );
      assert.deepEqual(
        calls.map((c) => (JSON.parse(String(c.init?.body)) as { texts: string[] }).texts.length),
        [256, 44],
      );
    },
  );
});

test("unconfigured is local: no request, no vectors", async () => {
  await withFetch(
    () => Response.json({}),
    async (calls) => {
      const remote = remoteOf({});
      assert.equal(remote.remoteConfigured(), false);
      assert.equal(await remote.remoteEmbed(["x"], "bulk"), null);
      assert.deepEqual(await remote.remoteHealth("bulk"), { configured: false, ok: true });
      assert.equal(calls.length, 0);
    },
  );
});

test("failures are observed with a bounded reason, and with fallback off each one throws", async () => {
  const cases: [string, (n: number) => Response | Promise<Response>, RemoteFailure["reason"]][] = [
    ["a 503", () => new Response(null, { status: 503 }), "http_5xx"],
    ["a 401", () => new Response(null, { status: 401 }), "http_4xx"],
    ["too few vectors", () => Response.json({ vectors: [] }), "malformed"],
    [
      "no connection",
      () => {
        throw new TypeError("fetch failed");
      },
      "unreachable",
    ],
  ];
  for (const [name, answer, reason] of cases) {
    const seen: RemoteFailure[] = [];
    await withFetch(
      (_url, _init, n) => answer(n),
      async () => {
        const remote = remoteOf(LANES, { onFailure: (f) => seen.push(f) });
        await assert.rejects(
          remote.remoteEmbed(["1"], "interactive"),
          /embedding service unavailable/,
          name,
        );
      },
    );
    assert.deepEqual(seen, [{ lane: "interactive", reason }], name);
  }
});

test("an observer that throws changes nothing about the failure", async () => {
  await withFetch(
    () => new Response(null, { status: 500 }),
    async () => {
      const remote = remoteOf(LANES, {
        onFailure: () => {
          throw new Error("observer broke");
        },
      });
      await assert.rejects(remote.remoteEmbed(["1"], "bulk"), /embedding service unavailable/);
    },
  );
});

test("LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK is on only for the exact word true: then a failure yields to the local model", async () => {
  const words: [string | undefined, boolean][] = [
    [undefined, false],
    ["true", true],
    ["false", false],
    ["TRUE", false],
    ["1", false],
    ["", false],
    [" true", false],
    ["nonsense", false],
  ];
  for (const [value, yields] of words) {
    await withFetch(
      () => new Response("no", { status: 500 }),
      async () => {
        const remote = remoteOf({ ...LANES, LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK: value });
        if (yields)
          assert.equal(await remote.remoteEmbed(["x"], "interactive"), null, String(value));
        else
          await assert.rejects(
            remote.remoteEmbed(["x"], "interactive"),
            /embedding service unavailable/,
            String(value),
          );
      },
    );
  }
});

test("a bulk embed refused while the sidecar wakes is tried again and counts no failure", async () => {
  const seen: RemoteFailure[] = [];
  const pauses: number[] = [];
  await withFetch(
    (_url, init, n) => {
      if (n <= 2) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      return vectorsFor(init);
    },
    async (calls) => {
      const remote = remoteOf(LANES, {
        onFailure: (f) => seen.push(f),
        pause: async (ms) => {
          pauses.push(ms);
        },
      });
      assert.deepEqual(await remote.remoteEmbed(["1", "2"], "bulk"), [[1], [2]]);
      assert.equal(calls.length, 3, "two refusals, then the answer");
    },
  );
  assert.deepEqual(pauses, [1_000, 2_000]);
  assert.deepEqual(seen, [], "a wake is not a failure");
});

test("a bulk lane that stays down fails after its tries, counted once as unreachable", async () => {
  const seen: RemoteFailure[] = [];
  await withFetch(
    () => {
      throw new TypeError("fetch failed");
    },
    async (calls) => {
      const remote = remoteOf(LANES, { onFailure: (f) => seen.push(f) });
      await assert.rejects(remote.remoteEmbed(["1"], "bulk"), /embedding service unavailable/);
      assert.equal(calls.length, 5, "the first try and four more");
    },
  );
  assert.deepEqual(seen, [{ lane: "bulk", reason: "unreachable" }]);
});

test("the query lane is never retried, and an answer that is not a network failure never is", async () => {
  await withFetch(
    () => {
      throw new TypeError("fetch failed");
    },
    async (calls) => {
      await assert.rejects(remoteOf(LANES).remoteEmbed(["1"], "interactive"));
      assert.equal(calls.length, 1);
    },
  );
  await withFetch(
    () => new Response(null, { status: 503 }),
    async (calls) => {
      await assert.rejects(remoteOf(LANES).remoteEmbed(["1"], "bulk"));
      assert.equal(calls.length, 1, "a 503 is the sidecar's own word");
    },
  );
});

test("each lane has its own limit: the bulk lane waits out a slow sidecar, the query lane fails fast", async (t) => {
  let answered = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const { texts } = JSON.parse(body) as { texts: string[] };
      setTimeout(() => {
        answered += 1;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ vectors: texts.map(() => [0.1, 0.2, 0.3]) }));
      }, 1_500);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const seen: RemoteFailure[] = [];
  const remote = remoteOf(
    {
      LOUVAIN_EMBEDDINGS_URL: url,
      LOUVAIN_EMBEDDINGS_BULK_URL: url,
      LOUVAIN_EMBEDDINGS_TIMEOUT_MS: "500",
      LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS: "5000",
      LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK: "false",
    },
    { onFailure: (f) => seen.push(f) },
  );
  const errors = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = errors;
  });
  assert.deepEqual(await remote.remoteEmbed(["a passage"], "bulk"), [[0.1, 0.2, 0.3]]);
  const before = answered;
  await assert.rejects(
    remote.remoteEmbed(["a question"], "interactive"),
    /embedding service unavailable/,
  );
  assert.equal(answered, before, "the query lane gave up before the sidecar answered it");
  assert.deepEqual(seen, [{ lane: "interactive", reason: "timeout" }]);
});

test("the bearer rides on every request when a token is set, and on none when it is not", async () => {
  await withFetch(
    (url, init) => (url.endsWith("/embed") ? vectorsFor(init) : Response.json({ counts: [1] })),
    async (calls) => {
      const remote = remoteOf({ ...LANES, LOUVAIN_SIDECAR_TOKEN: "sidecar-secret" });
      await remote.remoteEmbed(["1"], "interactive");
      await remote.remoteEmbed(["1"], "bulk");
      await remote.remoteHealth("bulk");
      await remote.remoteTokenCounts(["x"]);
      assert.equal(calls.length, 4);
      for (const c of calls)
        assert.equal(
          new Headers(c.init?.headers).get("authorization"),
          "Bearer sidecar-secret",
          c.url,
        );
      calls.length = 0;
      await remoteOf(LANES).remoteEmbed(["1"], "bulk");
      assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), null);
    },
  );
});

test("/count is the bulk sidecar's tokenizer, one count per text, and a short answer is refused", async () => {
  await withFetch(
    (_url, init) => {
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
      return Response.json({ counts: texts.map((t) => t.length) });
    },
    async (calls) => {
      assert.deepEqual(await remoteOf(LANES).remoteTokenCounts(["ab", "abcd"]), [2, 4]);
      assert.equal(calls[0]?.url, "http://bulk.invalid/count");
    },
  );
  await withFetch(
    () => Response.json({ counts: [1] }),
    async () => {
      await assert.rejects(remoteOf(LANES).remoteTokenCounts(["a", "b"]), /malformed/);
    },
  );
  await assert.rejects(remoteOf({}).remoteTokenCounts(["a"]), /need an embedding sidecar/);
});

test("a sidecar that embeds another way is a degraded lane, named", async () => {
  await withFetch(
    () => Response.json({ model: "other/model", pooling: "last", dimensions: 768 }),
    async () => {
      const health = await remoteOf(LANES).remoteHealth("bulk");
      assert.equal(health.ok, false);
      assert.match(
        health.reason ?? "",
        /^embedding model mismatch: pooling last ≠ mean, model other\/model ≠ /,
      );
    },
  );
});

test("the deployment's endpoints: unset, every lane is plain HTTP that is always up; given, its answers are used", async () => {
  await withFetch(
    (url, init) => (url.endsWith("/embed") ? vectorsFor(init) : Response.json({})),
    async (calls) => {
      const plain = remoteOf({
        LOUVAIN_EMBEDDINGS_URL: "http://query.example:8091",
        LOUVAIN_EMBEDDINGS_BULK_URL: "http://bulk.example:8092",
      });
      assert.equal(plain.bulkOnDemand(), false);
      assert.equal(plain.laneWakesOnRequest("bulk"), false);
      assert.equal((await plain.remoteHealth("bulk")).unprobed, undefined, "probed");
      await plain.remoteEmbed(["1"], "bulk");
      await plain.remoteEmbed(["2"], "interactive");
      assert.deepEqual(
        calls.map((c) => c.url),
        [
          "http://bulk.example:8092/healthz",
          "http://bulk.example:8092/embed",
          "http://query.example:8091/embed",
        ],
      );
    },
  );
  const jobs: Record<string, unknown>[] = [];
  await withFetch(
    () => Response.json({}),
    async (calls) => {
      const bound = remoteOf(
        {
          LOUVAIN_EMBEDDINGS_URL: "http://query.example:8091",
          LOUVAIN_EMBEDDINGS_BULK_URL: "http://jobs.example:8092",
        },
        {
          endpoints: {
            wakesOnRequest: (url) => url.startsWith("http://query.example"),
            bulkTransport: (endpoint) =>
              endpoint.startsWith("http://jobs.example")
                ? async (input) => {
                    jobs.push(input);
                    return {
                      vectors: ((input.texts as string[]) ?? []).map(() => [0, 1]),
                      space: { model: "m", pooling: "mean", dimensions: 768 },
                    };
                  }
                : null,
            queryEndpoint: async (endpoint) => endpoint,
          },
        },
      );
      assert.equal(bound.bulkOnDemand(), true);
      assert.equal(bound.laneWakesOnRequest("interactive"), true);
      assert.deepEqual(
        await bound.remoteHealth("bulk"),
        { configured: true, ok: true },
        "a job lane is not probed",
      );
      assert.equal((await bound.remoteHealth("interactive")).unprobed, true);
      assert.equal(
        await bound.sidecarHealthz("interactive"),
        null,
        "a lane that wakes is never probed",
      );
      assert.deepEqual(await bound.remoteEmbed(["one", "two"], "bulk"), [
        [0, 1],
        [0, 1],
      ]);
      assert.deepEqual(bound.lastStatedBulkSpace(), {
        model: "m",
        pooling: "mean",
        dimensions: 768,
      });
      assert.equal(calls.length, 0, "nothing went over plain HTTP");
    },
  );
  assert.equal(jobs.length, 1);
});
