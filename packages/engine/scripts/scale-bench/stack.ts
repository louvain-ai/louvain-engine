import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Embedder } from "@louvain/embeddings";
import { EMBEDDING_DIM } from "@louvain/embeddings";
import { createPluginRegistry, defineEngine } from "@louvain/engine-core";
import postgres from "postgres";
import {
  createEngine,
  type Engine,
  embedderFor,
  figuresRetriever,
  keywordRetriever,
  openHost,
  openStore,
  records,
  settingsOf,
  storeSettings,
  vectorRetriever,
} from "../../src/index.js";

/**
 * The stack the benchmark runs on: this install's (`./engine up`), read the way `./engine` reads it: its password and
 * sidecar token from `.engine/`, its ports from the environment or their defaults. Each scale gets a database of its
 * own, made from the baseline schema, so one scale's rows and statistics never reach another's; and so its own
 * workspace, whose keyword index is its own too.
 */

const ROLE = "engine";
const secret = (root: string, name: string) =>
  readFileSync(join(root, ".engine", name), "utf8").trim();

/** The install's settings, set in this process's environment before an engine is built. */
export function useInstall(root: string): { server: string } {
  const pg = process.env.LOUVAIN_PG_HOST_PORT ?? "5434";
  process.env.LOUVAIN_SIDECAR_TOKEN ??= secret(root, "sidecar-token");
  process.env.LOUVAIN_EMBEDDINGS_URL ??= `http://localhost:${process.env.LOUVAIN_EMBEDDINGS_HOST_PORT ?? "8091"}`;
  process.env.LOUVAIN_BM25_URL ??= `http://localhost:${process.env.LOUVAIN_BM25_HOST_PORT ?? "8095"}`;
  return { server: `postgres://${ROLE}:${secret(root, "db-password")}@localhost:${pg}/engine` };
}

/** A database for one scale, from the baseline schema, its URL in `DATABASE_URL`; made again if it is there. */
export async function freshDatabase(root: string, server: string, name: string): Promise<string> {
  const admin = postgres(server, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}" template template0 encoding 'UTF8'`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const url = new URL(server);
  url.pathname = `/${name}`;
  const loader = postgres(url.href, { max: 1, onnotice: () => {} });
  try {
    const shipped = join(root, "db", "baseline.sql");
    const schema = existsSync(shipped)
      ? shipped
      : join(root, "scripts", "engine-export", "baseline.sql");
    await loader.unsafe(readFileSync(schema, "utf8"));
  } finally {
    await loader.end({ timeout: 5 });
  }
  process.env.DATABASE_URL = url.href;
  return url.href;
}

/**
 * A stand-in for the embedder, for a scale embedding on this machine's CPU would take too long: each text a unit
 * vector of the model's width, from a hash of the text, so the vector index is built and sized as real vectors are.
 * Searching it would say nothing, so asking it to embed a query throws: a search run with it must be keyword-only.
 */
function standIn(real: Embedder): Embedder {
  const vectorOf = (text: string) => {
    const bytes = createHash("sha512").update(text).digest();
    const v = Array.from(
      { length: EMBEDDING_DIM },
      (_, i) => (bytes[i % bytes.length] ?? 0) - 127.5 + i / EMBEDDING_DIM,
    );
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
  return {
    ...real,
    embed: async (texts: string[]) => texts.map(vectorOf),
    embedQuery: async () => {
      throw new Error(
        "the stand-in embedder embeds no query: this scale is searched by keyword only",
      );
    },
  };
}

/** The engine for the database `DATABASE_URL` names, with the default configuration's sources and retrievers. */
export async function openBenchEngine(embedding: "real" | "stand-in"): Promise<Engine> {
  const plugins = await createPluginRegistry({
    ...defineEngine({ sources: [records()] }),
    retriever: [vectorRetriever(), keywordRetriever(), figuresRetriever()],
  });
  const store = openStore(process.env.DATABASE_URL as string, storeSettings);
  const host = openHost(store.sql);
  const real = embedderFor(host);
  return createEngine({
    store,
    embedder: embedding === "real" ? real : standIn(real),
    plugins,
    host,
    settings: settingsOf(undefined),
  });
}
