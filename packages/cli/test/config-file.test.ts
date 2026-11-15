import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defineEngine, PluginRefused } from "@louvain/engine-core";
import { readConfig } from "../src/config-file.js";

/** A newcomer's first errors, each one exact sentence. */
const configFile = (body: string): string => {
  const root = mkdtempSync(join(tmpdir(), "engine-config-"));
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(root, "engine.config.ts"), body);
  return join(root, "engine.config.ts");
};
const refusal = (sentence: string) => (err: unknown) =>
  err instanceof PluginRefused && err.message === sentence;
const defaults = defineEngine({});

describe("engine.config.ts", () => {
  it("is not needed: with no file the defaults run", async () => {
    const missing = join(tmpdir(), "no-such-folder", "engine.config.ts");
    assert.equal(await readConfig(missing, defaults), defaults);
  });

  it("stops the start at its line when it throws, and the defaults never stand in", async () => {
    const path = configFile(
      '// the readers\n// and keys\nthrow new Error("READER_KEY is not set");\n',
    );
    await assert.rejects(
      readConfig(path, defaults),
      refusal(
        `${path}:3 could not be loaded: READER_KEY is not set. ` +
          "The engine does not start on its defaults in place of a configuration that failed",
      ),
    );
  });

  it("is told what to export when it does not export defineEngine(…)", async () => {
    const path = configFile("export default { readers: [] };\n");
    await assert.rejects(
      readConfig(path, defaults),
      refusal(`${path} must export defineEngine({ … }) as its default`),
    );
  });
});
