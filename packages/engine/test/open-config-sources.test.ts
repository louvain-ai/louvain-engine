import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginRegistry, defineEngine, definePlugin, source } from "@louvain/engine-core";
import { z } from "zod";
import { IngestSourceRefused, openSource } from "../src/ingest/sources/index.js";
import type { Writes } from "../src/ingest/writes.js";
import { ingestDoor } from "../src/server/ingest-route.js";

/**
 * The sources a configuration names, as the engine opens them: two doors are refused, since the server has one; a
 * source is opened by name with its request checked first; and the only network a source is handed is the guarded
 * fetch, which refuses an address inside the network. The shipped file's sources are the CLI's to load
 * (`packages/cli/test/engine.test.ts`).
 */
const READ = "r".repeat(40);

test("two doors are refused: the server has one", async () => {
  const door = (name: string, token: string) =>
    definePlugin({
      kind: "source",
      name,
      create: () => ({
        ...source({
          request: z.unknown(),
          open: () => {
            throw new Error("unused");
          },
        }),
        door: { token },
      }),
    });
  const registry = await createPluginRegistry(
    defineEngine({ sources: [door("http", "a".repeat(32))()] }),
  );
  // The door carries the engine's writes to the ingest it runs; none runs here.
  const writes = { sql: {} as Writes["sql"], hooks: {} };
  assert.ok(ingestDoor({ plugins: registry, writes }, READ));
  const two = await createPluginRegistry(
    defineEngine({ sources: [door("http", "a".repeat(32))(), door("webhook", "b".repeat(32))()] }),
  );
  assert.throws(
    () => ingestDoor({ plugins: two, writes }, READ),
    /opens 2 ingest doors \(http, webhook\)/,
  );
});

test("a source is opened by name, its request checked first, with the guarded fetch as its only network", async () => {
  let handed: ((url: string) => Promise<unknown>) | undefined;
  const reader = definePlugin({
    kind: "source",
    name: "service",
    create: () =>
      source({
        request: z.object({ collection: z.string() }),
        open: ({ collection }, { fetch }) => {
          handed = (url) =>
            fetch(url, { accept: "application/json", signal: AbortSignal.timeout(5_000) });
          return {
            collection,
            origin: "service",
            lists: "some",
            items: async function* () {},
            complete: () => true,
          };
        },
      }),
  });
  const registry = await createPluginRegistry(defineEngine({ sources: [reader()] }));
  assert.throws(
    () => openSource(registry, "nowhere", {}),
    /no source is called "nowhere" \(engine.config.ts runs: service\)/,
  );
  assert.throws(() => openSource(registry, "service", {}), IngestSourceRefused);
  assert.equal(openSource(registry, "service", { collection: "c" }).collection, "c");
  for (const url of [
    "http://example.com/",
    "https://127.0.0.1/",
    "https://10.0.0.8/",
    "https://localhost/",
  ]) {
    const got = (await handed?.(url)) as { ok: boolean };
    assert.equal(got.ok, false, url);
  }
});
