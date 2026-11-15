import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginRegistry, defineEngine } from "@louvain/engine-core";
import { documents } from "../src/index.js";

/** The general reader: every format doctext reads as a fallback, narrowed by its settings, and a page count kept. */
const reader = async (plugin = documents()) =>
  (await createPluginRegistry(defineEngine({ readers: [plugin] }))).list("fileReader")[0]?.plugin;

test("it claims every format doctext reads, as a fallback", async () => {
  const r = await reader();
  assert.equal(r?.name, "documents");
  assert.equal(r?.claims.rank, "fallback");
  for (const ext of ["pdf", "docx", "pptx", "xlsx", "md", "txt"])
    assert.ok(r?.claims.extensions.includes(ext), ext);
});

test("extensions narrows what it claims, and an extension it does not read stops the start", async () => {
  const narrowed = await reader(documents({ extensions: ["pdf", "docx", "pdf"] }));
  assert.deepEqual(narrowed?.claims.extensions, ["pdf", "docx"]);
  assert.throws(
    () => documents({ extensions: ["pdf", "exe"] as never }),
    /"documents" refuses its settings[\s\S]*extensions\[1\]/,
  );
});

test("it reads a file's text, and refuses what doctext refuses", async () => {
  const r = await reader();
  assert.deepEqual(await r?.read(new TextEncoder().encode("hello"), "a.txt"), { text: "hello" });
  const refused = await r?.read(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "broken.pdf");
  assert.ok(refused && "refused" in refused, JSON.stringify(refused));
});
