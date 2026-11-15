import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginRegistry, defineEngine } from "@louvain/engine-core";
import { text } from "../src/index.js";

/** The reader: txt, md and markdown as UTF-8, specific, narrowed by its settings. */
const reader = async (plugin = text()) =>
  (await createPluginRegistry(defineEngine({ readers: [plugin] }))).list("fileReader")[0]?.plugin;

test("it claims plain text and Markdown as specific, and reads the bytes as UTF-8", async () => {
  const r = await reader();
  assert.deepEqual(r?.claims, { extensions: ["txt", "md", "markdown"] });
  assert.deepEqual(await r?.read(new TextEncoder().encode("# Café"), "a.md"), { text: "# Café" });
});

test("extensions narrows what it claims, and an extension it does not read stops the start", async () => {
  assert.deepEqual((await reader(text({ extensions: ["txt"] })))?.claims.extensions, ["txt"]);
  assert.throws(
    () => text({ extensions: ["pdf"] as never }),
    /"text" refuses its settings[\s\S]*"txt"\|"md"\|"markdown"/,
  );
});
