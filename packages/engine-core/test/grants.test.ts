import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_READER } from "../src/caller.js";
import { type Grants, ReaderNameSchema } from "../src/grants.js";
import { defineEngine } from "../src/plugins/config.js";
import { PluginRefused } from "../src/plugins/plugin.js";
import { createPluginRegistry } from "../src/plugins/registry.js";

/**
 * A configuration's grants: which collections each named reader may read. A reader's name is one alphabet, kept as a
 * file name and an id as written; the default reader takes no grant; a collection is a collection's name. Each refusal
 * is one sentence at the configuration's line, never a grant read past.
 */
const refusal = (pattern: RegExp) => (err: unknown) =>
  err instanceof PluginRefused && pattern.test(err.message);

describe("a configuration's grants", () => {
  it("are carried as written, and none is no grant at all", () => {
    const grants: Grants = { alice: ["handbook", "desk"], bob: [] };
    assert.deepEqual(defineEngine({ grants }).grants, grants);
    assert.equal(defineEngine({}).grants, undefined);
  });

  it("ride with the plugins, and start none", async () => {
    const registry = await createPluginRegistry(defineEngine({ grants: { alice: ["handbook"] } }));
    assert.deepEqual(registry.list("fileReader"), []);
  });

  it("refuse a name that is not a reader's, and the default reader's", () => {
    for (const name of ["Alice", "a b", "../x", "-x", "", "x".repeat(65), DEFAULT_READER])
      assert.throws(
        () => defineEngine({ grants: { [name]: ["handbook"] } }),
        refusal(/^the configuration's grants name "/),
        JSON.stringify(name),
      );
  });

  it("refuse a collection that is not a collection's name", () => {
    for (const collection of ["", "a/b", "*", "x".repeat(101)])
      assert.throws(
        () => defineEngine({ grants: { alice: [collection] } }),
        refusal(/^the configuration's grants for "alice": /),
        JSON.stringify(collection),
      );
  });

  it("refuse a grant that is not a list", () => {
    assert.throws(
      () => defineEngine({ grants: { alice: "handbook" } as unknown as Grants }),
      refusal(/^the configuration's grants for "alice": /),
    );
  });
});

describe("a reader's name", () => {
  it("is lower-case letters, digits, dashes and underscores, at most 64, and never the default reader's", () => {
    for (const name of ["alice", "a", "ops-team", "bot_2", "x".repeat(64)])
      assert.equal(ReaderNameSchema.safeParse(name).success, true, name);
    for (const name of ["Alice", "a.b", "_a", "x".repeat(65), DEFAULT_READER, "constructor "])
      assert.equal(ReaderNameSchema.safeParse(name).success, false, name);
  });
});
