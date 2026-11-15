/**
 * `./engine reindex`: the keyword index rebuilt from what is loaded. Prints the count; a record the index still missed
 * after its passes is named, and the command exits 1, as it does when no keyword index is configured.
 */
import { NoKeywordIndex, openHost, PASSES, reindexKeywords } from "@louvain/engine";
import { PluginRefused } from "@louvain/engine-core";
import { openEngine } from "./engine.js";
import { stopOn } from "./stop.js";

const engine = await openEngine(openHost).catch(stopOn(PluginRefused));
process.exitCode = await reindex().finally(() => engine.close());

async function reindex(): Promise<number> {
  const done = await reindexKeywords(engine.writes).catch((err: unknown) => {
    if (!(err instanceof NoKeywordIndex)) throw err;
    console.error(`reindex: ${err.message}`);
    return null;
  });
  if (done === null) return 1;
  const missed = done.missed.length;
  console.log(
    `Keyword index: ${done.indexed} records indexed again${missed ? `, ${missed} missed` : ""}.`,
  );
  if (missed === 0) return 0;
  console.error(
    `reindex: the keyword index did not take ${done.missed.join(", ")} after ${PASSES} tries; ` +
      "check it is up (./engine logs bm25) and run ./engine reindex again.",
  );
  return 1;
}
