import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileReaderLane, IngestDoorRefused, ingestDoor, openHost, poolOf } from "@louvain/engine";
import { openEngine } from "../src/engine.js";

/**
 * The configuration, as `./engine` loads it: engine.config.ts in a root whose `packages` is this checkout's.
 * No file runs the defaults; a file's kinds replace the defaults' and its settings reach the engine; the shipped file
 * runs no reranker until its sidecar line is uncommented, no ingest door until its sources line is, and the app beside
 * the tools until its surfaces line is; two rerankers are refused in one sentence; and its answerer, the agent, says
 * which key it needs when there is none.
 */
const repo = join(import.meta.dirname, "..", "..", "..");
const shipped = readFileSync(join(repo, "engine.config.ts"), "utf8");

async function withConfig<T>(text: string | null, run: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "engine-config-"));
  try {
    symlinkSync(join(repo, "packages"), join(root, "packages"));
    // The packages a configuration imports by name, linked at the root as an install links them.
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
    if (text !== null) writeFileSync(join(root, "engine.config.ts"), text);
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const configWith = (fields: string, imports = "") =>
  `import { defineEngine } from "./packages/engine-core/src/plugins/config.js";\n${imports}` +
  `export default defineEngine({ ${fields} });\n`;

test("with no engine.config.ts the defaults run: two readers, two sources, MCP and the app, three legs, no answerer, every setting its default", async () => {
  await withConfig(null, async (root) => {
    const { plugins, settings } = await openEngine(openHost, root);
    const lane = fileReaderLane(plugins);
    assert.equal(lane.readerFor("terms.pdf")?.name, "documents");
    assert.equal(lane.readerFor("notes.md")?.name, "text");
    assert.equal(lane.readerFor("photo.png"), undefined);
    assert.deepEqual(
      plugins.list("source").map((s) => s.name),
      ["folder", "records"],
    );
    assert.deepEqual(
      plugins.list("retriever").map((r) => r.name),
      ["vector", "keyword", "figures"],
    );
    assert.deepEqual(plugins.list("answerer"), []);
    assert.deepEqual(settings.retrieval, { searchQuestion: true });
    assert.equal(settings.server.toolDeadlineMs, 60_000);
    assert.deepEqual(
      plugins.list("surface").map((s) => s.name),
      ["mcp", "app"],
    );
  });
});

test("a kind the configuration names replaces the defaults' list; the kinds it leaves out keep theirs", async () => {
  const text = configWith(
    "readers: [text()]",
    'import { text } from "./packages/plugins/reader-text/src/index.ts";\n',
  );
  await withConfig(text, async (root) => {
    const { plugins } = await openEngine(openHost, root);
    assert.equal(fileReaderLane(plugins).readerFor("notes.md")?.name, "text");
    assert.equal(fileReaderLane(plugins).readerFor("terms.pdf"), undefined);
    assert.deepEqual(
      plugins.list("source").map((s) => s.name),
      ["folder", "records"],
    );
  });
});

test("a setting the configuration states is the one the engine reads; the others keep their defaults", async () => {
  const stated =
    "settings: { retrieval: { searchQuestion: false }, server: { toolDeadlineMs: 5000 } }";
  await withConfig(configWith(stated), async (root) => {
    const { settings } = await openEngine(openHost, root);
    assert.equal(settings.retrieval.searchQuestion, false);
    assert.equal(settings.server.toolDeadlineMs, 5000);
    assert.equal(settings.rerank.window, 30);
  });
});

/** The shipped file with its local reranker's lines uncommented, as its comment tells a person to. */
const withSidecar = shipped
  .replace("// import { sidecar }", "import { sidecar }")
  .replace(
    /\/\/ reranker: sidecar\(\{\n((?: {2}\/\/ .*\n)*?) {2}\/\/ \}\),/,
    (_line, body: string) => `reranker: sidecar({\n${body.replaceAll("  // ", "  ")}  }),`,
  );

test("the shipped configuration runs no reranker", async () => {
  await withConfig(shipped, async (root) => {
    const engine = await openEngine(openHost, root);
    assert.deepEqual(engine.plugins.list("reranker"), []);
    assert.equal(poolOf(engine).pool.reranker, null);
  });
});

test("its sidecar line, uncommented, puts the local reranker on the search pool", async () => {
  assert.match(withSidecar, /^ {2}reranker: sidecar\(\{$/m, "the shipped file carries the lines");
  await withConfig(withSidecar, async (root) => {
    const engine = await openEngine(openHost, root);
    const { plugins } = engine;
    const [started] = plugins.list("reranker");
    assert.equal(started?.name, "sidecar");
    assert.equal(started?.plugin.model, "BAAI/bge-reranker-v2-m3");
    assert.equal(poolOf(engine).pool.reranker, started?.plugin);
  });
});

test("a configuration naming two rerankers is refused", async () => {
  const two = configWith(
    'reranker: [sidecar({ url: "http://localhost:8096" }), cohere({ apiKey: "a stand-in" })] as never',
    'import { cohere } from "./packages/plugins/reranker-cohere/src/index.js";\n' +
      'import { sidecar } from "./packages/plugins/reranker-sidecar/src/index.js";\n',
  );
  await withConfig(two, async (root) => {
    await assert.rejects(openEngine(openHost, root), /names 2 rerankers; it takes one/);
  });
});

const READ = "r".repeat(40);
/** The shipped file with its sources' lines uncommented, as its comment tells a person to. */
const withDoor = shipped
  .replace(/^\/\/ (import \{ (?:folder, records|http) \})/gm, "$1")
  .replace("  // sources: [", "  sources: [");

/** The configuration loaded with these settings in the environment, then the environment as it was. */
async function openWith(text: string, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await withConfig(text, (root) => openEngine(openHost, root));
  } finally {
    process.env = saved;
  }
}

test("the shipped configuration runs the folder and records sources and opens no door", async () => {
  const engine = await openWith(shipped, { LOUVAIN_ENGINE_INGEST_TOKEN: "w".repeat(40) });
  assert.deepEqual(
    engine.plugins.list("source").map((s) => s.name),
    ["folder", "records"],
  );
  assert.equal(ingestDoor(engine, READ), null, "a token in the environment opens nothing");
});

test("its sources line, uncommented, opens the door with its own token", async () => {
  const opened = await openWith(withDoor, { LOUVAIN_ENGINE_INGEST_TOKEN: "w".repeat(40) });
  assert.deepEqual(
    opened.plugins.list("source").map((s) => s.name),
    ["folder", "records", "http"],
  );
  assert.equal(ingestDoor(opened, READ)?.token, "w".repeat(40));
  assert.throws(
    () => ingestDoor(opened, "w".repeat(40)),
    IngestDoorRefused,
    "never the read token",
  );
  await assert.rejects(openWith(withDoor), /opens only with its own token/);
  await assert.rejects(openWith(withDoor, { LOUVAIN_ENGINE_INGEST_TOKEN: "short" }), /at least 32/);
});

test("the shipped configuration names the agent as Ask's answerer, and without a key it says which setting it needs", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { plugins } = await openWith(shipped);
    assert.deepEqual(plugins.one("answerer"), {
      ready: false,
      name: "agent",
      needs: "ANTHROPIC_API_KEY",
    });
    assert.deepEqual(plugins.list("answerer"), []);
  } finally {
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
  }
});

test("its surfaces line, uncommented, serves the tools alone", async () => {
  const toolsAlone = shipped
    .replace("// import { mcp }", "import { mcp }")
    .replace("  // surfaces: [mcp()]", "  surfaces: [mcp()]");
  const { plugins } = await openWith(toolsAlone);
  assert.deepEqual(
    plugins.list("surface").map((s) => s.name),
    ["mcp"],
  );
});
