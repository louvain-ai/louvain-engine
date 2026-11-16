import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBaselineDatabase, skipWithoutDatabase } from "./database.js";
import { freePort, keywordIndexForTests, noKeywordIndex } from "./keyword-index.js";
import { startStandIns } from "./stand-ins.js";

/**
 * Two readers through the real server: the commands `./engine` runs (`reader.ts`, `ingest.ts`, `serve.ts`), in a root
 * of their own whose engine.config.ts grants alice the handbook and bob the desk, over a database of the test's own.
 * The same search, the same document and the same status answer each reader from its own collection alone, over MCP
 * and the app alike; a document of the other's answers as one that does not exist; a reader with a token and no grant
 * reads nothing; the engine's own token reads both; and a token removed is refused once the server starts again.
 */
const OWN = "o".repeat(40);
const CONFIG = `import { defineEngine } from "@louvain/engine-core";
export default defineEngine({ grants: { alice: ["handbook"], bob: ["desk"] } });
`;
const HANDBOOK = `{"key":"leave","title":"Annual leave","text":"Staff take twenty-five days of annual leave a year."}\n`;
const DESK = `{"key":"booking","title":"Desk booking","text":"Annual leave frees a desk: book it at the facilities desk."}\n`;

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const tsx = import.meta.resolve("tsx");
const entry = (name: string) => join(repo, "packages", "cli", "src", `${name}.ts`);
const skip = skipWithoutDatabase || noKeywordIndex() || false;

/** Where the commands run: a root of their own, as a clone is, over a database, a keyword index and an embedder. */
type World = { dir: string; env: NodeJS.ProcessEnv; close: () => Promise<void> };

async function openWorld(): Promise<World> {
  const index = await keywordIndexForTests();
  if (typeof index === "string") throw new Error(index);
  const db = await createBaselineDatabase("readers");
  const models = await startStandIns();
  const dir = mkdtempSync(join(tmpdir(), "engine-readers-"));
  symlinkSync(join(repo, "packages"), join(dir, "packages"));
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  writeFileSync(join(dir, "engine.config.ts"), CONFIG);
  // The commands read the world's settings and none of the shell's.
  const shell = Object.entries(process.env).filter(([name]) => !name.startsWith("LOUVAIN_"));
  const env = {
    ...Object.fromEntries(shell),
    DATABASE_URL: db.url,
    LOUVAIN_EMBEDDINGS_URL: models.url,
    LOUVAIN_BM25_URL: index.url,
  };
  const close = async () => {
    rmSync(dir, { recursive: true, force: true });
    index.stop();
    await models.close();
    await db.drop();
  };
  return { dir, env, close };
}

/** One of `./engine`'s commands in the world, its standard input `input`; its exit and what it said. */
function command(world: World, name: string, args: string[], input = "") {
  const child = spawn(process.execPath, ["--import", tsx, entry(name), ...args], {
    cwd: world.dir,
    env: world.env,
  });
  const run = { status: -1, stdout: "", stderr: "" };
  child.stdout.on("data", (c: Buffer) => {
    run.stdout += c.toString();
  });
  child.stderr.on("data", (c: Buffer) => {
    run.stderr += c.toString();
  });
  child.stdin.end(input);
  return new Promise<typeof run>((done) =>
    child.on("close", (code) => done({ ...run, status: code ?? -1 })),
  );
}

/** The tool server in the world, on `port`, once it says it is listening. */
function serve(world: World, port: number): Promise<ChildProcess> {
  const env = { ...world.env, LOUVAIN_ENGINE_PORT: String(port), LOUVAIN_ENGINE_TOKEN: OWN };
  const server = spawn(process.execPath, ["--import", tsx, entry("serve")], {
    cwd: world.dir,
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) resolve(server);
    });
    server.on("exit", (code) => reject(new Error(`the server exited (${code})`)));
  });
}

const stop = (server: ChildProcess) =>
  new Promise<void>((done) => {
    server.removeAllListeners("exit");
    server.once("exit", () => done());
    server.kill();
  });

/** A client of one server: MCP tool calls and the app's routes, each with a bearer token, and a browser's sign-in. */
function client(port: number) {
  const base = `http://127.0.0.1:${port}`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  return {
    async tool(token: string, name: string, args: Record<string, unknown>) {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          ...bearer(token),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      });
      if (res.status !== 200) return { status: res.status };
      const { result } = (await res.json()) as { result: { structuredContent: unknown } };
      return result.structuredContent as Record<string, unknown>;
    },
    async app(path: string, init: { token?: string; cookie?: string } = {}) {
      const res = await fetch(`${base}/app/api/${path}`, {
        headers: {
          ...(init.token ? bearer(init.token) : {}),
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    async signIn(token: string) {
      const res = await fetch(`${base}/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ token }),
      });
      return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    },
  };
}

/** A search page's documents, matched or loosely related: a hidden one must be in neither. */
type Hit = { id: string; title: string };
type Page = { sources?: Hit[]; looselyRelated?: Hit[] } | undefined;
const hits = (page: unknown) => [
  ...((page as Page)?.sources ?? []),
  ...((page as Page)?.looselyRelated ?? []),
];
const titles = (page: unknown) =>
  hits(page)
    .map((s) => s.title)
    .sort();
const sourceOf = (page: unknown, title: string) =>
  hits(page).find((s) => s.title === title)?.id ?? "";

/** Three readers made by the command (alice, bob, and carol, whom no grant names), and two collections loaded. */
async function readersAndCollections(world: World): Promise<(name: string) => string> {
  const token = (name: string) =>
    readFileSync(join(world.dir, ".engine", "readers", name), "utf8").trim();
  for (const name of ["alice", "bob", "carol"]) {
    const made = await command(world, "reader", ["add", name]);
    assert.equal(made.status, 0, made.stderr);
    assert.ok(!made.stdout.includes(token(name)), "a token is named by its file, never printed");
  }
  for (const [collection, items] of [
    ["handbook", HANDBOOK],
    ["desk", DESK],
  ] as const) {
    const args = ["records", "--records", "-", "--collection", collection];
    const loaded = await command(world, "ingest", args, items);
    assert.equal(loaded.status, 0, loaded.stderr);
  }
  return token;
}

test("two readers read through the real server, each its own collections alone", {
  skip,
  timeout: 240_000,
}, async (t) => {
  const world = await openWorld();
  try {
    const token = await readersAndCollections(world);
    const port = await freePort();
    let server = await serve(world, port);
    const call = client(port);
    const search = (who: string) =>
      call.tool(who, "louvain_search_sources", { query: "annual leave" });
    try {
      const everyone = await search(OWN);

      await t.test(
        "the same search finds each reader's own collection, and the engine's token both",
        async () => {
          assert.deepEqual(titles(everyone), ["Annual leave", "Desk booking"]);
          assert.deepEqual(titles(await search(token("alice"))), ["Annual leave"]);
          assert.deepEqual(titles(await search(token("bob"))), ["Desk booking"]);
        },
      );

      await t.test("a document of the other's answers as one that does not exist", async () => {
        const read = (who: string, sourceId: string) =>
          call.tool(who, "louvain_read_source", { sourceId });
        const theirs = await read(token("alice"), sourceOf(everyone, "Desk booking"));
        const nowhere = await read(token("alice"), "no-such-document");
        assert.ok((theirs as { error?: string }).error, "it is refused");
        assert.deepEqual(theirs, nowhere);
        const own = await read(token("alice"), sourceOf(everyone, "Annual leave"));
        assert.equal((own as { title?: string }).title, "Annual leave");
      });

      await t.test("the app's status counts and names only what the reader reads", async () => {
        const status = async (who: string) => (await call.app("status", { token: who })).body;
        const counted = (s: Record<string, unknown>) => [s.documents, s.collections];
        const one = (name: string) => [1, [{ name, documents: 1 }]];
        assert.deepEqual(counted(await status(OWN)), [
          2,
          [
            { name: "desk", documents: 1 },
            { name: "handbook", documents: 1 },
          ],
        ]);
        assert.deepEqual(counted(await status(token("alice"))), one("handbook"));
        assert.deepEqual(counted(await status(token("bob"))), one("desk"));
      });

      await t.test("a browser signed in with a reader's token reads as that reader", async () => {
        const cookie = await call.signIn(token("bob"));
        assert.ok(cookie, "the sign-in answers with a cookie");
        const found = await call.app("search?q=annual%20leave", { cookie });
        assert.equal(found.status, 200);
        assert.deepEqual(titles(found.body), ["Desk booking"]);
      });

      await t.test("a reader with a token and no grant reads nothing", async () => {
        assert.deepEqual(titles(await search(token("carol"))), []);
        assert.equal((await call.app("status", { token: token("carol") })).body.documents, 0);
      });

      await t.test("a token removed is refused once the server starts again", async () => {
        const carol = token("carol");
        const removed = await command(world, "reader", ["remove", "carol"]);
        assert.equal(removed.status, 0, removed.stderr);
        await stop(server);
        server = await serve(world, port);
        const refused = await call.tool(carol, "louvain_search_sources", { query: "leave" });
        assert.equal((refused as { status?: number }).status, 401);
        assert.equal((await call.app("status", { token: carol })).status, 401);
        assert.deepEqual(titles(await search(token("alice"))), ["Annual leave"]);
      });
    } finally {
      await stop(server);
    }
  } finally {
    await world.close();
  }
});
