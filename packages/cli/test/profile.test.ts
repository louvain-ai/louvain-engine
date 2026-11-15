import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openHost } from "@louvain/engine/kg/read/open-readable-set";
import { fileReaderLane } from "@louvain/engine/open/file-readers/index";
import { openEngine } from "../src/engine.js";
import { over } from "../src/profile.js";

/**
 * A PROFILE IS A FOLDER WITH ITS OWN engine.config.ts: the one `.engine/profile` names runs instead of the root's, its
 * settings over the root's leaf by leaf, its state its own; with none remembered, the root's runs as ever; a remembered
 * name with no folder is refused, saying how to return.
 */
const repo = join(import.meta.dirname, "..", "..", "..");

async function withRoot<T>(files: Record<string, string>, run: (root: string) => Promise<T>) {
  const root = mkdtempSync(join(tmpdir(), "engine-profile-"));
  try {
    symlinkSync(join(repo, "packages"), join(root, "packages"));
    // The packages a configuration imports by name, linked at the root as an install links them.
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const config = (to: string, fields: string, imports = "") =>
  `import { defineEngine } from "${to}packages/engine-core/src/plugins/config.js";\n${imports}` +
  `export default defineEngine({ ${fields} });\n`;
const ROOT = config("./", "settings: { rerank: { window: 10, blend: 0.2 } }");
const PROFILE = config(
  "../../",
  "readers: [text()], settings: { rerank: { window: 150 } }",
  'import { text } from "../../packages/plugins/reader-text/src/index.ts";\n',
);

test("the remembered profile runs its own engine.config.ts, its settings over the root's, its state its own", async () => {
  const files = {
    "engine.config.ts": ROOT,
    "profiles/scored/engine.config.ts": PROFILE,
    ".engine/profile": "scored\n",
  };
  await withRoot(files, async (root) => {
    const { plugins, settings, profile } = await openEngine(openHost, root);
    assert.equal(profile.name, "scored");
    assert.equal(profile.state, join(root, ".engine", "profiles", "scored"));
    assert.equal(
      fileReaderLane(plugins).readerFor("terms.pdf"),
      undefined,
      "its readers, not the root's",
    );
    assert.deepEqual([settings.rerank.window, settings.rerank.blend], [150, 0.2]);
  });
});

test("with no profile remembered the root's runs, its state the install's own", async () => {
  await withRoot({ "engine.config.ts": ROOT }, async (root) => {
    const { settings, profile } = await openEngine(openHost, root);
    assert.deepEqual([profile.name, profile.state], [null, join(root, ".engine")]);
    assert.equal(settings.rerank.window, 10);
  });
});

test("a remembered profile with no folder is refused, saying how to return to the root's", async () => {
  await withRoot({ ".engine/profile": "gone\n" }, async (root) => {
    await assert.rejects(
      openEngine(openHost, root),
      /the profile "gone" this install remembers has no profiles\/gone\/engine.config.ts: \.\/engine profile set default/,
    );
  });
});

test("settings go over others leaf by leaf, a list or a value whole", () => {
  assert.deepEqual(over({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 3 }, d: [2] }), {
    a: { b: 3, c: 2 },
    d: [2],
  });
  assert.deepEqual(over({ a: 1 }, undefined), { a: 1 });
});
