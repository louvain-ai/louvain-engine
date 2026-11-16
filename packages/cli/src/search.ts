/**
 * One search from the terminal: `./engine search [--full-ids] [--question "<question>"] "<words>"`. Prints the ranked
 * documents one a line, the page the tool server returns, ids shortened unless `--full-ids`.
 */

import type { Engine } from "@louvain/engine";
import {
  counted,
  openHost,
  openReading,
  openSearch,
  SEARCH_USAGE,
  type SearchArgs,
  type SearchLineHit,
  searchArgs,
  searchLine,
} from "@louvain/engine";
import { DEFAULT_READER, PluginRefused } from "@louvain/engine-core";
import { openEngine } from "./engine.js";
import { stopOn, usage } from "./stop.js";

const asked = searchArgs(process.argv.slice(2)) ?? usage(SEARCH_USAGE);
const engine = await openEngine(openHost).catch(stopOn(PluginRefused));
await printSearch(engine, asked)
  .catch((err: unknown) => failed(engine, err))
  .finally(() => engine.close());

async function printSearch(engine: Engine, asked: SearchArgs) {
  const page = await openSearch(engine)({
    query: asked.words,
    ...(asked.question ? { question: asked.question } : {}),
  });
  // A reranker that was configured and did not answer is said, never passed off as a ranking it did not make.
  if ("degraded" in page && page.degraded?.includes("rerank:documents"))
    console.log(
      "Not reranked: the reranker did not answer, so these are ranked by words and meaning alone.",
    );
  const hits: SearchLineHit[] = "sources" in page ? page.sources : [];
  if (hits.length === 0) console.log(await nothingFound(engine));
  hits.forEach((hit, at) => {
    console.log(searchLine(hit, at + 1, { fullIds: asked.fullIds }));
  });
}

async function nothingFound(engine: Engine): Promise<string> {
  const loaded = await loadedCount(engine);
  return loaded === 0
    ? "Nothing found: no documents are loaded yet. Load a folder with ./engine ingest folder --folder <path>."
    : `Nothing found among ${counted(loaded, "loaded document")}.`;
}

/** A failed search is said to the person who ran it, with a hint when nothing is loaded, and exits 1. */
async function failed(engine: Engine, err: unknown) {
  console.error(`search failed: ${err instanceof Error ? err.message : "unknown error"}`);
  // swallowed: the count only adds a hint to a failure already said; a database that is down cannot give it.
  if ((await loadedCount(engine).catch(() => null)) === 0)
    console.error(
      "No documents are loaded yet. Load a folder with ./engine ingest folder --folder <path>.",
    );
  process.exitCode = 1;
}

/** How many documents the search's reader reads, counted under its fence as the search was. */
async function loadedCount(engine: Engine): Promise<number> {
  return (await openReading(engine)(DEFAULT_READER).counts()).documents;
}
