import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsOf } from "../src/config/settings.js";

/** The default engine's settings, which its tools' arguments follow. */
const DEFAULTS = settingsOf(undefined);

/**
 * An argument the open tool does not declare is refused by name, never dropped (`tool-input.ts` `toolArgs`): dropped,
 * a filter would return an unfiltered page that looked like a match. No database: the check reads only the schema
 * the server serves.
 */
const { toolArgs } = await import("../src/open/tool-input.js");
const { ToolInputError } = await import("../src/open/source-tools/tool-helpers.js");

test("a declared argument passes, and an undefined one is left out", () => {
  assert.deepEqual(
    toolArgs("louvain_search_sources", { query: "budget", limit: 5, mode: undefined }, DEFAULTS),
    {
      query: "budget",
      limit: 5,
    },
  );
});

test("an undeclared argument is refused, naming it and what the tool takes", () => {
  assert.throws(
    () =>
      toolArgs(
        "louvain_search_sources",
        { query: "budget", app: "chat", collection: "board" },
        DEFAULTS,
      ),
    (err: unknown) =>
      err instanceof ToolInputError &&
      err.name === "ToolInputError" &&
      /has no "app", "collection" argument here; it takes query, /.test(err.message),
  );
});

test("a declared argument that does not fit the served schema is refused, naming it and what it takes", () => {
  const refused = (name: string, args: Record<string, unknown>, said: RegExp) =>
    assert.throws(
      () => toolArgs(name, args, DEFAULTS),
      (err: unknown) => err instanceof ToolInputError && said.test(err.message),
    );
  refused("louvain_search_sources", { query: 42 }, /"query" must be text, not number 42/);
  refused(
    "louvain_search_sources",
    { query: "x", limit: "20" },
    /"limit" must be a number, not the text "20"/,
  );
  refused(
    "louvain_search_sources",
    { query: "x", mode: "semantic" },
    /"mode" must be one of "hybrid", "keyword"/,
  );
  refused("louvain_search_sources", { query: "x", exclude: "doc-1" }, /"exclude" must be a list/);
  refused("louvain_search_sources", { query: "x", exclude: ["doc-1", 5] }, /item 2 is not one/);
  refused("louvain_read_source", {}, /a "sourceId" is required/);
  refused(
    "louvain_search_sources",
    { query: "x", after: "soon" },
    /"after" must be a date, not the text "soon"/,
  );
  refused(
    "louvain_search_sources",
    { query: "x", asOf: "yesterday" },
    /"asOf" must be a date or a datetime/,
  );
  assert.deepEqual(
    toolArgs("louvain_search_sources", { query: "x", limit: 5, view: "list" }, DEFAULTS),
    {
      query: "x",
      limit: 5,
      view: "list",
    },
  );
});
