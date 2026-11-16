/**
 * What a read route is handed (`Reading`), for one reader: the engine's tools and its counts bound to that reader, so
 * every call a route makes reads under that reader's fence, and the configuration's answerer. Made once per engine,
 * bound per request.
 */
import type { Reading } from "@louvain/engine-core";
import { loadedCounts } from "../read/loaded-counts.js";
import { workspaceIdOnce } from "../store/tenant.js";
import { openTools, type ToolEngine, toolList } from "./tools/run.js";

/** The engine's reading for one reader. */
export type ReadingFor = (principal: string) => Omit<Reading, "reader">;

export function openReading(engine: ToolEngine): ReadingFor {
  const tools = openTools(engine);
  const orgId = workspaceIdOnce(engine.store.sql);
  const answerer = engine.plugins.one("answerer");
  return (principal) => ({
    tools: () => toolList(engine),
    tool: tools(principal),
    counts: async () => loadedCounts(engine.context, { orgId: await orgId(), principal }),
    answerer,
  });
}
