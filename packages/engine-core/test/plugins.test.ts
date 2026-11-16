import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { defineEngine, type EngineConfig, withDefaults } from "../src/plugins/config.js";
import { definePlugin, PluginRefused } from "../src/plugins/plugin.js";
import { createPluginRegistry } from "../src/plugins/registry.js";

/** A file reader that records its life in `log`, and fails to start when told to. */
const reader = (name: string, log: string[] = [], fails = false) =>
  definePlugin({
    kind: "fileReader",
    name,
    create: async () => {
      if (fails) throw new Error("no key was given");
      log.push(`start ${name}`);
      return { name, claims: { extensions: [name] }, read: () => ({ text: "" }) };
    },
    close: () => {
      log.push(`close ${name}`);
    },
  })();

const capped = definePlugin({
  kind: "fileReader",
  name: "capped",
  settings: z.object({ url: z.url(), limit: z.number().int().positive().default(10) }),
  create: ({ url, limit }) => ({
    name: url,
    claims: { extensions: [String(limit)] },
    read: () => ({ text: "" }),
  }),
});

const started = async (config: EngineConfig) => createPluginRegistry(defineEngine(config));
const names = async (config: EngineConfig, defaults = defineEngine({})) =>
  (await createPluginRegistry(withDefaults(defineEngine(config), defaults)))
    .list("fileReader")
    .map((r) => r.name);
const refusal = (sentence: string | RegExp) => (err: unknown) =>
  err instanceof PluginRefused &&
  (typeof sentence === "string" ? err.message === sentence : sentence.test(err.message));

describe("a plugin author", () => {
  it("gets its settings parsed by its own schema, defaults applied, when its factory is called", async () => {
    const [only] = (await started({ readers: [capped({ url: "https://reader.example" })] })).list(
      "fileReader",
    );
    assert.deepEqual(only?.plugin.claims.extensions, ["10"]);
    assert.throws(
      () => capped({ url: "not a url" }),
      refusal(/^the fileReader "capped" refuses its settings:\n✖ Invalid URL\n {2}→ at url$/),
    );
  });

  it("may call a factory whose settings all have defaults with nothing, which means the defaults", async () => {
    const roomy = definePlugin({
      kind: "fileReader",
      name: "roomy",
      settings: z.object({ limit: z.number().default(7) }),
      create: ({ limit }) => ({
        name: "roomy",
        claims: { extensions: [String(limit)] },
        read: () => ({ text: "" }),
      }),
    });
    for (const plugin of [roomy(), roomy({})]) {
      const [only] = (await started({ readers: [plugin] })).list("fileReader");
      assert.deepEqual(only?.plugin.claims.extensions, ["7"]);
    }
    assert.throws(
      () => (capped as () => unknown)(),
      refusal(/^the fileReader "capped" refuses its settings:/),
    );
  });

  it("is started once, at start, may take its time, and is closed latest first", async () => {
    const log: string[] = [];
    const registry = await started({ readers: [reader("a", log), reader("b", log)] });
    registry.list("fileReader");
    await registry.close();
    assert.deepEqual(log, ["start a", "start b", "close b", "close a"]);
  });
});

describe("a configuration", () => {
  it("runs a list in the order it is written", async () => {
    assert.deepEqual(await names({ readers: [reader("pdf"), reader("md"), reader("docx")] }), [
      "pdf",
      "md",
      "docx",
    ]);
  });

  it("keeps a kind's defaults when it leaves the kind out, and replaces them when it names it", async () => {
    const defaults = defineEngine({ readers: [reader("pdf"), reader("md")] });
    assert.deepEqual(await names({}, defaults), ["pdf", "md"]);
    assert.deepEqual(await names({ readers: [reader("csv")] }, defaults), ["csv"]);
    assert.deepEqual(await names({ readers: [] }, defaults), []);
  });

  it("names one reranker or none, and refuses two", async () => {
    const reranker = (name: string) =>
      definePlugin({
        kind: "reranker",
        name,
        create: () => ({ model: name, rerank: async () => ({ ok: true as const, scores: [] }) }),
      })();
    const defaults = defineEngine({ reranker: reranker("local") });
    const rerankers = async (config: EngineConfig) =>
      (await createPluginRegistry(withDefaults(defineEngine(config), defaults)))
        .list("reranker")
        .map((r) => r.plugin.model);
    assert.deepEqual(await rerankers({}), ["local"]);
    assert.deepEqual(await rerankers({ reranker: reranker("remote") }), ["remote"]);
    assert.deepEqual(await rerankers({ reranker: null }), []);
    assert.throws(
      () =>
        defineEngine({
          reranker: [reranker("a"), reranker("b")] as unknown as EngineConfig["reranker"],
        }),
      refusal("the configuration names 2 rerankers; it takes one"),
    );
  });

  it("starts its plugins whatever settings ride with them", async () => {
    const registry = await started({ readers: [reader("md")], settings: {} });
    assert.deepEqual(
      registry.list("fileReader").map((r) => r.name),
      ["md"],
    );
  });

  it("names one answerer or none, none by default, and refuses two", async () => {
    const answerer = (name: string) =>
      definePlugin({
        kind: "answerer",
        name,
        create: () => ({ notReady: `${name.toUpperCase()}_KEY` }),
      })();
    const one = async (config: EngineConfig) =>
      (await createPluginRegistry(defineEngine(config))).one("answerer");
    assert.equal(await one({}), null);
    assert.equal(await one({ answerer: null }), null);
    // An answerer started without what it needs waits, and says the setting; nothing runs in its name.
    const registry = await createPluginRegistry(defineEngine({ answerer: answerer("agent") }));
    assert.deepEqual(registry.one("answerer"), { ready: false, name: "agent", needs: "AGENT_KEY" });
    assert.deepEqual(registry.list("answerer"), []);
    assert.deepEqual(registry.waiting("answerer"), [{ name: "agent", needs: "AGENT_KEY" }]);
    assert.throws(
      () =>
        defineEngine({
          answerer: [answerer("a"), answerer("b")] as unknown as EngineConfig["answerer"],
        }),
      refusal("the configuration names 2 answerers; it takes one"),
    );
  });

  it("is a value: two registries made from two configurations share nothing", async () => {
    assert.deepEqual(
      [await names({ readers: [reader("pdf")] }), await names({ readers: [reader("md")] })],
      [["pdf"], ["md"]],
    );
  });
});

describe("a newcomer's first errors, each one exact sentence", () => {
  it("an unknown field names the fields there are, and a host member is refused by name", () => {
    assert.throws(
      () => defineEngine({ translator: [] } as EngineConfig),
      refusal(
        `a configuration has no "translator"; it names readers, reranker, sources, surfaces, answerer, settings, grants`,
      ),
    );
    assert.throws(
      () => defineEngine({ readableSet: {} } as EngineConfig),
      refusal(
        `"readableSet" is a host binding, not a plugin: it is bound in code, never in a configuration`,
      ),
    );
  });

  it("a plugin in the wrong place, or named twice, is refused by name", () => {
    const misplaced = { ...reader("md"), kind: "reranker" } as unknown as ReturnType<typeof reader>;
    assert.throws(
      () => defineEngine({ readers: [misplaced] }),
      refusal("the configuration's readers holds a reranker where a fileReader belongs"),
    );
    assert.throws(
      () => defineEngine({ readers: [reader("md"), reader("md")] }),
      refusal(`the configuration's readers names "md" twice`),
    );
  });

  it("a plugin that fails to start stops the start by name, and those already started are closed", async () => {
    const log: string[] = [];
    await assert.rejects(
      started({ readers: [reader("warm", log), reader("keyless", log, true)] }),
      refusal(`the fileReader "keyless" failed to start: no key was given`),
    );
    assert.deepEqual(log, ["start warm", "close warm"]);
  });
});

describe("the types", () => {
  it("refuse a wrong contract, an unknown kind, a bare object and a wrong setting", () => {
    const file = fileURLToPath(new URL("./plugins.types.ts", import.meta.url));
    const config = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
    const parsed = ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    assert.ok(parsed);
    const options = { ...parsed.options, noEmit: true, rootDir: undefined };
    const messages = ts
      .getPreEmitDiagnostics(ts.createProgram([file], options))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.deepEqual(messages, []);
  });
});
