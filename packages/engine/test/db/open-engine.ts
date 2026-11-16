import { Duplex } from "node:stream";
import type { Host } from "@louvain/engine-core";
import postgres from "postgres";
import type { Engine } from "../../src/engine.js";
import { openStore, type Store, storeOf } from "../../src/store/pool.js";

/**
 * The open build's engine as a test builds it, as an open entry does (`packages/cli/src/engine.ts`): over a store it
 * opens on the test's database (`openStore`), with no plugins and the default settings, and the embedder made for its
 * host. The host reads each reader's set from its projection rows (`openReadableSet`), the default reader's that the
 * loader writes and a partial reader's that a test writes itself; a reader by grant is read through the real
 * server (`two-readers.test.ts`). Its reads and writes ask that embedder (`embedderOf`). Made once per process, on first
 * use, after the test has set the environment the pool and the embedder read; a case that searches through plugins
 * hands its own beside it (`{ ...engine, plugins }`). A database these tests did not make is refused: every query on it
 * fails naming it and connects nowhere, while a case that never queries (a unit test building the open engine to see
 * what it binds) is untouched.
 */
let made: Promise<Engine> | undefined;

export const openTestEngine = (): Promise<Engine> => {
  made ??= build();
  return made;
};

async function build(): Promise<Engine> {
  const { config, storeSettings } = await import("../../src/config/engine.js");
  const refusal = refusalOf(config.databaseUrl);
  const store =
    refusal === null
      ? openStore(config.databaseUrl, storeSettings)
      : refusedStore(config.databaseUrl, refusal);
  const { createEngine } = await import("../../src/engine.js");
  const { embedderFor } = await import("../../src/host/embedder.js");
  const { settingsOf } = await import("../../src/config/settings.js");
  const { openReadableSet } = await import("../../src/host/standalone.js");
  const host: Host = { readableSet: openReadableSet(store.sql) };
  const engine = createEngine({
    store,
    embedder: embedderFor(host),
    plugins: { list: () => [], waiting: () => [], one: () => null, close: async () => {} },
    host,
    settings: settingsOf(undefined),
  });
  return engine;
}

/** Why a database is not the test's, or null: the engine's tests make and drop their own, every one named `*_test`. */
function refusalOf(url: string): string | null {
  const name = new URL(url).pathname.replace(/^\//, "");
  return name.endsWith("_test")
    ? null
    : `the engine's tests run on a database they made (a *_test one), not ${name}`;
}

/**
 * A store on a refused database: its pool connects through a socket that fails its first write with the refusal and
 * then closes (postgres.js's socket factory, documented and absent from its types). A factory that throws instead is
 * caught but never closed, so its pool slot would never come back and every later query would hang.
 */
function refusedStore(url: string, reason: string): Store {
  const socket = () =>
    new Duplex({
      read() {},
      write(_chunk, _encoding, done) {
        done(new Error(reason));
      },
    });
  return storeOf(postgres(url, { onnotice: () => {}, ...{ socket } }), {
    readTimeoutMs: 1,
    plan: null,
  });
}
