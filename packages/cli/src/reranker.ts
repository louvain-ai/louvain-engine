/**
 * Which reranker the configuration runs, for the wrapper (`./engine up`): one line, the plugin's name and its model,
 * tab-separated, or `none`. The wrapper builds and starts the local sidecar only when it is `sidecar`, with that model,
 * so the configuration is where the choice is made. The reranker alone starts: no reader, source or surface.
 */
import { createPluginRegistry, defineEngine, PluginRefused } from "@louvain/engine-core";
import { configuration } from "./configuration.js";
import { stopOn } from "./stop.js";

const plugins = await configuration()
  .then(({ plugins: { reranker } }) =>
    createPluginRegistry(defineEngine({ reranker: reranker?.[0] ?? null })),
  )
  .catch(stopOn(PluginRefused));
const configured = plugins.one("reranker");
console.log(configured?.ready ? `${configured.name}\t${configured.plugin.model}` : "none");
await plugins.close();
