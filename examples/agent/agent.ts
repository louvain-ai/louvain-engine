/**
 * What an agent does with the engine, without the agent: connect to the tool server over MCP with its token, list the
 * tools, search, read the top document and print the passage that matched, with its source. No model, no API key: this
 * is the tools' side of the conversation, and it exits non-zero when any step fails, so it also checks the server.
 * The default question asks the sample corpus, whose company, people and places are invented.
 *
 *   ./engine up
 *   ./engine ingest folder --folder examples/sample-corpus
 *   node --import tsx examples/agent/agent.ts ["<question>"] [--expect <title>]
 *
 * The server's address is http://127.0.0.1:<LOUVAIN_ENGINE_PORT, default 8080>/mcp (the port from the shell or `.env`,
 * as `./engine` reads it) and its token is LOUVAIN_ENGINE_TOKEN, else the file `.engine/token`. `--expect <title>`
 * also fails unless the top document's title contains it.
 *
 * MCP over HTTP is JSON-RPC in POST bodies; this file speaks it with `fetch` so that it needs no client library.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_QUESTION = "When does the Harbour Street lease renew?";

/** The engine's setting from the shell, else the repository's `.env` (the one `./engine` loads). */
function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const env = resolve(ROOT, ".env");
  if (!existsSync(env)) return undefined;
  const line = readFileSync(env, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

function token(): string {
  const fromSetting = setting("LOUVAIN_ENGINE_TOKEN");
  if (fromSetting) return fromSetting;
  const file = resolve(ROOT, ".engine/token");
  if (!existsSync(file)) fail("no token yet: run ./engine up first");
  return readFileSync(file, "utf8").trim();
}

function fail(message: string): never {
  console.error(`agent: ${message}`);
  process.exit(1);
}

const url = `http://127.0.0.1:${setting("LOUVAIN_ENGINE_PORT") ?? "8080"}/mcp`;
const bearer = token();
let nextId = 1;

/** One JSON-RPC call; its result, or a failure naming the method. */
async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch {
    return fail(`nothing is answering at ${url}. Run ./engine up first.`);
  }
  if (res.status === 401) fail(`the server at ${url} refused the token`);
  if (!res.ok) fail(`${method}: the server answered ${res.status}`);
  const reply = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (reply.error || !reply.result) fail(`${method}: ${reply.error?.message ?? "no result"}`);
  return reply.result;
}

/** A tool's structured result; a tool that reports an error fails the run. */
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const out = await rpc("tools/call", { name, arguments: args });
  if (out.isError) fail(`${name}: ${JSON.stringify(out.content)}`);
  return out.structuredContent;
}

type Hit = { id: string; title?: string; excerpt?: string; modifiedAt?: string };
type Page = { sources?: Hit[] };
type Document = { title?: string | null; text?: string; textLength?: number };

const args = process.argv.slice(2);
const expectAt = args.indexOf("--expect");
const expected = expectAt === -1 ? undefined : args[expectAt + 1];
const question =
  args.filter((a, i) => !a.startsWith("--") && i !== expectAt + 1).join(" ") || DEFAULT_QUESTION;

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "engine-example-agent", version: "0.1.0" },
});
const server = init.serverInfo as { name: string; version: string };
console.log(`Connected to ${server.name} ${server.version} at ${url}`);
await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});

const { tools } = (await rpc("tools/list")) as { tools: { name: string; title?: string }[] };
console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);
for (const needed of ["louvain_search_sources", "louvain_read_source"])
  if (!tools.some((t) => t.name === needed)) fail(`the server offers no ${needed}`);

console.log(`\nSearching: ${question}`);
const page = (await callTool("louvain_search_sources", { query: question, limit: 3 })) as Page;
const top = page.sources?.[0];
if (!top)
  fail(
    "the search found nothing. Load the sample documents with ./engine ingest folder --folder examples/sample-corpus",
  );
if (expected && !top.title?.toLowerCase().includes(expected.toLowerCase()))
  fail(`expected the top result to be "${expected}", got "${top.title}"`);

const doc = (await callTool("louvain_read_source", { sourceId: top.id })) as Document;
if (!doc.text) fail(`the document ${top.id} came back with no text`);

console.log(
  `Top result: ${top.title ?? "(untitled)"} (${doc.textLength ?? doc.text.length} characters read)`,
);
console.log(`\n  ${(top.excerpt ?? doc.text.slice(0, 400)).replace(/\s+/g, " ").trim()}\n`);
console.log(
  `Source: ${doc.title ?? top.title} · ${top.modifiedAt?.slice(0, 10) ?? "undated"} · ${top.id}`,
);
