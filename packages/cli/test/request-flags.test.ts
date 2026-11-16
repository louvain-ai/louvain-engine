import assert from "node:assert/strict";
import { test } from "node:test";
import { folder, records } from "@louvain/engine";
import { z } from "zod";
import { fieldsOf, helpOf, optionsOf, requestOf } from "../src/request-flags.js";

/**
 * A source's request is its command line: the shipped sources' fields as flags, with their descriptions; a numeric or
 * repeated field read as the schema types it; and a request that is not an object has no flags.
 */
const requestOfSource = async (plugin: typeof folder | typeof records) =>
  (await plugin().create()).request;

test("the shipped sources' fields are their flags, described, the required ones said", async () => {
  const fields = fieldsOf(await requestOfSource(folder));
  assert.deepEqual(
    fields.map((f) => [f.name, f.type, f.required]),
    [
      ["folder", "string", true],
      ["collection", "string", false],
    ],
  );
  assert.match(helpOf(fields)[0] ?? "", /^ {2}--folder <value> +the folder .*; required$/);
  assert.deepEqual(
    fieldsOf(await requestOfSource(records)).map((f) => f.name),
    ["records", "collection"],
  );
});

test("a field is read as its schema types it: a switch, a number, a list", () => {
  const fields = fieldsOf(
    z.object({ deep: z.boolean().optional(), limit: z.number().int(), tags: z.array(z.string()) }),
  );
  assert.deepEqual(optionsOf(fields), {
    deep: { type: "boolean", multiple: false },
    limit: { type: "string", multiple: false },
    tags: { type: "string", multiple: true },
  });
  assert.deepEqual(requestOf(fields, { deep: true, limit: "20", tags: ["a", "b"] }), {
    deep: true,
    limit: 20,
    tags: ["a", "b"],
  });
});

test("a request that is not an object takes no flags", () => {
  assert.deepEqual(fieldsOf(z.unknown()), []);
});
