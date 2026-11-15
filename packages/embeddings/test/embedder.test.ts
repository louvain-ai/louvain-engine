import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbedder, type QueryEmbedTiming } from "../src/index.js";
import { fitDimensions } from "../src/local.js";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "../src/settings.js";
import { missingFromStatement, sidecarDisagreement } from "../src/space-statement.js";
import { settingsOf, withFetch } from "./helpers.js";

/**
 * An embedder is made from its settings and holds its own state. A model's conventions are configuration and unset they
 * are bge-base's; a Matryoshka cut is declared, never inferred; a query is timed for the host whichever way it ends; the
 * space is the producer's, freshest statement first; and two embedders share nothing. Stub `fetch`, no model loaded.
 */
const BGE_INSTRUCTION = "Represent this sentence for searching relevant passages: ";
const SIDECAR = {
  LOUVAIN_EMBEDDINGS_URL: "http://sidecar.invalid",
  LOUVAIN_EMBEDDINGS_LOCAL_FALLBACK: "false",
};
const unit = (): number[] => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

test("unset, the settings are bge-base's: mean pooling, BGE's instruction, no cut", () => {
  assert.deepEqual(createEmbedder(settingsOf()).settings(), {
    model: EMBEDDING_MODEL,
    pooling: "mean",
    queryInstruction: BGE_INSTRUCTION,
    matryoshka: false,
  });
});

test("a Qwen3-style model: last-token pooling and an instruction whose \\n is a newline", () => {
  const s = createEmbedder(
    settingsOf({
      LOUVAIN_EMBEDDING_POOLING: "last",
      LOUVAIN_EMBEDDING_QUERY_INSTRUCTION:
        "Instruct: retrieve the passages that answer it\\nQuery: ",
    }),
  ).settings();
  assert.equal(s.pooling, "last");
  assert.equal(s.queryInstruction, "Instruct: retrieve the passages that answer it\nQuery: ");
});

test("an empty instruction means none, and an unknown pooling is refused", () => {
  assert.equal(
    createEmbedder(settingsOf({ LOUVAIN_EMBEDDING_QUERY_INSTRUCTION: "" })).settings()
      .queryInstruction,
    "",
  );
  assert.throws(() => settingsOf({ LOUVAIN_EMBEDDING_POOLING: "cls" }), /mean or last/);
});

test("LOUVAIN_EMBEDDING_MATRYOSHKA is on only for the exact word true", () => {
  for (const [value, on] of [
    [undefined, false],
    ["true", true],
    ["false", false],
    ["TRUE", false],
    ["1", false],
    ["", false],
    [" true", false],
  ] as const) {
    assert.equal(
      createEmbedder(settingsOf({ LOUVAIN_EMBEDDING_MATRYOSHKA: value })).settings().matryoshka,
      on,
      String(value),
    );
  }
});

test("settings given as a function are read once, on first use, and held", () => {
  let reads = 0;
  const e = createEmbedder(() => {
    reads++;
    return settingsOf({ LOUVAIN_EMBEDDING_MATRYOSHKA: reads === 1 ? "true" : "false" });
  });
  assert.equal(reads, 0, "nothing read at construction");
  assert.equal(e.settings().matryoshka, true);
  assert.equal(
    e.settings().matryoshka,
    true,
    "a vector-space setting never changes under a running embedder",
  );
  assert.equal(reads, 1);
});

test("Matryoshka: a wider vector is cut to the column's width and re-normalised; undeclared, it is refused", () => {
  const wide = Array.from({ length: EMBEDDING_DIM + 256 }, (_, i) => (i % 7) - 3);
  const [cut] = fitDimensions([wide], true);
  assert.equal(cut?.length, EMBEDDING_DIM);
  const norm = Math.sqrt((cut ?? []).reduce((a, x) => a + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, `unit length, got ${norm}`);
  const lead = wide.slice(0, EMBEDDING_DIM);
  const leadNorm = Math.sqrt(lead.reduce((a, x) => a + x * x, 0));
  assert.ok(
    Math.abs((cut?.[5] ?? 0) - (lead[5] ?? 0) / leadNorm) < 1e-12,
    "the leading dimensions keep their direction",
  );
  assert.throws(() => fitDimensions([wide], false), /MATRYOSHKA/);
  const exact = Array.from({ length: EMBEDDING_DIM }, () => 0.5);
  assert.deepEqual(
    fitDimensions([exact], false),
    [exact],
    "a vector at the column's width passes untouched",
  );
});

test("a sidecar's wider vectors are refused unless the embedder declares Matryoshka", async () => {
  await withFetch(
    () => Response.json({ vectors: [Array.from({ length: EMBEDDING_DIM + 8 }, () => 1)] }),
    async () => {
      await assert.rejects(createEmbedder(settingsOf(SIDECAR)).embed(["x"]), /MATRYOSHKA/);
      const [v] = await createEmbedder(
        settingsOf({ ...SIDECAR, LOUVAIN_EMBEDDING_MATRYOSHKA: "true" }),
      ).embed(["x"]);
      assert.equal(v?.length, EMBEDDING_DIM);
    },
  );
});

test("a sidecar that embeds another way is a named disagreement, and an unreported field is not one", () => {
  const mine = createEmbedder(settingsOf()).settings();
  assert.equal(
    sidecarDisagreement(
      { model: EMBEDDING_MODEL, pooling: "mean", dimensions: EMBEDDING_DIM },
      mine,
    ),
    null,
  );
  assert.equal(
    sidecarDisagreement({ dimensions: EMBEDDING_DIM }, mine),
    null,
    "an older sidecar reports only its width",
  );
  const qwen = {
    model: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    pooling: "last",
    dimensions: EMBEDDING_DIM,
  };
  const reason = sidecarDisagreement(qwen, mine) ?? "";
  assert.match(reason, /^embedding model mismatch: /);
  assert.match(reason, /pooling last ≠ mean/);
  assert.match(reason, /model onnx-community\/Qwen3-Embedding-0\.6B-ONNX ≠ /);
  assert.match(sidecarDisagreement({ dimensions: 1024 }, mine) ?? "", /dimensions 1024 ≠ 768/);
  const alike = createEmbedder(
    settingsOf({ LOUVAIN_EMBEDDING_MODEL: qwen.model, LOUVAIN_EMBEDDING_POOLING: "last" }),
  );
  assert.equal(alike.sidecarDisagreement(qwen), null, "configured alike, they agree");
});

test("the embedder states a whole space by its own settings, as the Node sidecar states it", () => {
  const qwen = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
  const e = createEmbedder(
    settingsOf({
      LOUVAIN_EMBEDDING_MODEL: qwen,
      LOUVAIN_EMBEDDING_POOLING: "last",
      LOUVAIN_EMBEDDING_MATRYOSHKA: "true",
    }),
  );
  const space = e.localSpaceStatement();
  assert.deepEqual(space, {
    model: qwen,
    pooling: "last",
    dimensions: EMBEDDING_DIM,
    matryoshka: true,
    truncation: "after-special-tokens",
  });
  assert.deepEqual(missingFromStatement(space), [], "nothing for readiness to call unknown");
  assert.equal(e.sidecarDisagreement(space), null, "and it agrees with the process it serves");
});

test("a query embedding is timed with its outcome and model, answered or refused, and carries the instruction", async () => {
  const seen: QueryEmbedTiming[] = [];
  let status = 200;
  await withFetch(
    () => (status === 200 ? Response.json({ vectors: [unit()] }) : new Response("{}", { status })),
    async (calls) => {
      const e = createEmbedder(
        settingsOf({ ...SIDECAR, LOUVAIN_EMBEDDING_MODEL: "example/custom-768" }),
        {
          observe: { query: (t) => seen.push(t) },
        },
      );
      assert.equal((await e.embedQuery("who owns the renewal?")).length, EMBEDDING_DIM);
      const sent = JSON.parse(String(calls[0]?.init?.body)) as { texts: string[]; lane: string };
      assert.deepEqual(sent, {
        texts: [`${BGE_INSTRUCTION}who owns the renewal?`],
        lane: "interactive",
      });
      status = 500;
      await assert.rejects(() => e.embedQuery("and the next one?"));
    },
  );
  assert.deepEqual(
    seen.map((t) => [t.outcome, t.model]),
    [
      ["ok", "example/custom-768"],
      ["error", "example/custom-768"],
    ],
  );
  assert.ok(seen.every((t) => t.ms >= 0 && Number.isFinite(t.ms)));
});

test("documents go to the bulk lane with no instruction, and nothing is sent for nothing", async () => {
  await withFetch(
    () => Response.json({ vectors: [unit()] }),
    async (calls) => {
      const e = createEmbedder(settingsOf(SIDECAR));
      assert.deepEqual(await e.embed([]), []);
      assert.equal(calls.length, 0);
      await e.embed(["a passage"]);
      assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
        texts: ["a passage"],
        lane: "bulk",
      });
    },
  );
});

test("the space: in-process when no sidecar is configured, else what the bulk lane stated, else what it says on /healthz", async () => {
  const local = await createEmbedder(settingsOf()).space();
  assert.equal(local?.detail.producer, "in-process");
  assert.equal(
    local?.fingerprint,
    `${EMBEDDING_MODEL}|mean|${EMBEDDING_DIM}|full|after-special-tokens`,
  );

  const whole = {
    model: "m",
    pooling: "mean",
    dimensions: EMBEDDING_DIM,
    matryoshka: false,
    truncation: "t",
  };
  await withFetch(
    (url) =>
      url.endsWith("/healthz")
        ? Response.json(whole)
        : Response.json({ vectors: [unit()], space: { ...whole, model: "stated" } }),
    async (calls) => {
      const e = createEmbedder(settingsOf(SIDECAR));
      assert.equal((await e.space())?.fingerprint, `m|mean|${EMBEDDING_DIM}|full|t`, "probed");
      assert.equal((await e.space())?.fingerprint, `m|mean|${EMBEDDING_DIM}|full|t`);
      assert.equal(calls.length, 1, "a recent probe is reused");
      await e.embed(["x"]);
      assert.equal(
        (await e.space())?.detail.model,
        "stated",
        "the last statement wins over the probe",
      );
      assert.equal(
        (await e.space({ fresh: true }))?.detail.model,
        "m",
        "fresh reads the producer now",
      );
    },
  );
});

test("a statement that lacks a field is an unknown space, and says what it lacks", async () => {
  await withFetch(
    () => Response.json({ model: "m", pooling: "mean", dimensions: EMBEDDING_DIM }),
    async () => {
      const e = createEmbedder(settingsOf(SIDECAR));
      assert.equal(await e.space(), null);
      assert.deepEqual(e.spaceUnstated(), ["matryoshka"]);
    },
  );
  await withFetch(
    () => new Response(null, { status: 503 }),
    async () => {
      assert.equal(
        await createEmbedder(settingsOf(SIDECAR)).space(),
        null,
        "an unanswered probe is nothing to record",
      );
    },
  );
});

test("two embedders share nothing: one's outage, statement and probe are its own", async () => {
  const seen: string[] = [];
  await withFetch(
    (url) =>
      url.startsWith("http://down.invalid")
        ? new Response(null, { status: 503 })
        : Response.json({
            vectors: [unit()],
            space: { model: "up", pooling: "mean", dimensions: EMBEDDING_DIM, matryoshka: false },
          }),
    async () => {
      const down = createEmbedder(
        settingsOf({ ...SIDECAR, LOUVAIN_EMBEDDINGS_URL: "http://down.invalid" }),
        {
          observe: { failure: () => seen.push("down") },
        },
      );
      const up = createEmbedder(
        settingsOf({ ...SIDECAR, LOUVAIN_EMBEDDINGS_URL: "http://up.invalid" }),
        {
          observe: { failure: () => seen.push("up") },
        },
      );
      await assert.rejects(down.embed(["x"]));
      await up.embed(["x"]);
      assert.equal((await up.space())?.detail.model, "up");
      assert.equal(await down.space(), null);
    },
  );
  assert.deepEqual(seen, ["down"]);
});
