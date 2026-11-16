import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER, type Route } from "@louvain/engine-core";
import { errorsToLog } from "../src/observability/errors-to-log.js";
import { telemetry } from "../src/observability/telemetry.js";
import { readerTable } from "../src/server/readers.js";
import { type ServeSettings, serve } from "../src/server/serve.js";

/**
 * An error is never written nowhere: with no telemetry sink given or registered, the tool server's catch-all and every
 * other `telemetry.error` write one scrubbed line to the log (`errorsToLog`), so a route that throws leaves its name,
 * its exception and its first frames in the server's log, while its caller is told only `internal`. What the failing
 * call held (a quoted value, an address) is scrubbed out of the line.
 */

/** Every line written to stderr while `run` runs: where the logger writes an error, in both of its formats. */
async function stderrOf(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    await run();
  } finally {
    process.stderr.write = write;
  }
  return lines.join("");
}

test("a route that throws answers internal and leaves a scrubbed line naming it in the log", async () => {
  const throwing: Route = {
    method: "GET",
    path: "/boom",
    needs: "none",
    handle: async () => {
      throw new Error("could not read 'Kestrel renewal draft' for priya@example.test");
    },
  };
  const settings: ServeSettings = {
    port: 0,
    toolDeadlineMs: 5_000,
    token: "t".repeat(40),
    readers: readerTable([{ principal: DEFAULT_READER, token: "t".repeat(40) }]),
    door: null,
  };
  const read = {
    tools: () => [],
    tool: async () => ({}),
    counts: async () => ({ documents: 0, collections: [] }),
    answerer: null,
  };
  const server = await serve(
    settings,
    [{ name: "page", plugin: { routes: [throwing] } }],
    () => read,
  );
  const { port } = server.address() as { port: number };
  let status = 0;
  let body = "";
  const logged = await stderrOf(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/boom`);
    status = res.status;
    body = await res.text();
    // The line is written in the request's catch, before the answer is relayed; a tick lets the stream flush.
    await new Promise((r) => setImmediate(r));
  });
  server.close();
  assert.equal(status, 500);
  assert.deepEqual(JSON.parse(body), { error: "internal" }, "the caller learns nothing of it");
  assert.match(logged, /open\.http\.route failed/, "the line names what failed");
  assert.match(logged, /Error/, "and the exception");
  assert.match(logged, /server-errors\.test/, "with the frames that find the throw");
  assert.ok(!logged.includes("Kestrel renewal draft"), "the quoted value is scrubbed out");
  assert.ok(!logged.includes("priya@example.test"), "and the address");
});

test("errorsToLog writes errors only, with their tags; counts and timings go nowhere", () => {
  const lines: { message: string; fields: Record<string, unknown> | undefined }[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string, fields?: Record<string, unknown>) => lines.push({ message, fields }),
    sayOnce: () => {},
  };
  const sink = errorsToLog(logger);
  sink.count("search.cut", 1);
  sink.timing("search.ms", 12);
  sink.error("kg.read.generated", new TypeError("bad row"), { leg: "passage" });
  sink.error("ask.progress", "a string thrown");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.message, "kg.read.generated failed");
  assert.equal(lines[0]?.fields?.error, "TypeError: bad row");
  assert.equal(lines[0]?.fields?.leg, "passage");
  assert.equal(lines[1]?.fields?.error, "a string thrown");
});

test("the door with no sink registered reports an error to the process's log, never nowhere", async () => {
  const logged = await stderrOf(async () => {
    telemetry.error("passages.read_off", new Error("lost"));
  });
  assert.match(logged, /passages\.read_off failed/);
});
