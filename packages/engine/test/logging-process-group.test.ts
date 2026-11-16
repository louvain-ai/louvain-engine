import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The process group is read when the first line is written, not when the logger loads. A deployment sets
 * `LOUVAIN_PROCESS_GROUP` from its platform's own name in a module its entry point may load after the logger; a value
 * read at import would leave every line without its `process` field, which the log shipper's label is read from.
 */
test("a line carries the process group set after the logger was imported, before its first line", async () => {
  delete process.env.LOUVAIN_PROCESS_GROUP;
  process.env.LOUVAIN_LOG_JSON = "true";
  const { log } = await import("../src/observability/logging.js");
  process.env.LOUVAIN_PROCESS_GROUP = "worker";
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    log.info("the first line");
  } finally {
    process.stdout.write = write;
  }
  const line = JSON.parse(lines.find((l) => l.includes("the first line")) ?? "{}") as Record<
    string,
    unknown
  >;
  assert.equal(line.process, "worker");
});
