/**
 * The tool server `./engine up` starts: the configuration's surfaces (the tools at `/mcp` and the app at `/app/` by
 * default) over the engine's plugins, its token in the profile's state. Surfaces that clash stop the start by name. It
 * stops when it is asked to, and closes the engine.
 */
import { openHost, RouteClash, ServerRefused, startToolServer } from "@louvain/engine";
import { PluginRefused } from "@louvain/engine-core";
import { openEngine } from "./engine.js";
import { stopOn } from "./stop.js";

const engine = await openEngine(openHost).catch(stopOn(PluginRefused));
const server = await startToolServer(engine, engine.profile.state).catch(
  stopOn(ServerRefused, RouteClash),
);
// Asked to stop, it stops taking requests, then closes the engine: its plugins, then its pool.
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => void engine.close().finally(() => process.exit(0))));
