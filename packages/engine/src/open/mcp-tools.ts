import type { PluginRegistry } from "@louvain/engine-core";
import type { Engine } from "../engine.js";
import type { ReadContext } from "../kg/read/fence.js";
import { retrieverPool } from "../search/pool.js";
import type { ToolResult, ToolRun } from "./mcp-protocol.js";
import { OPEN_PRINCIPAL, openOrgId } from "./org.js";
import { lookupSource } from "./source-tools/lookup.js";
import { readSourcePage } from "./source-tools/read-page.js";
import { searchOrList } from "./source-tools/search-apps.js";
import { str, ToolInputError } from "./source-tools/tool-helpers.js";
import { toolArgs } from "./tool-input.js";

/**
 * The tools a request names, run as the engine's one reader (`org.ts`) on the engine's read context, each on its
 * arguments parsed once by the schema `tools/list` serves (`tool-input.ts`): an undeclared or wrong argument is refused
 * with a sentence, never dropped.
 */
type ReaderId = { orgId: string; principal: string };
type Pool = { pool: ReturnType<typeof retrieverPool> };
/** What a tool call runs on: the engine's read context, the one reader, and the search pool. */
type ToolCall = { context: ReadContext; reader: ReaderId; pool: Pool };
type OpenTool = (asked: Record<string, unknown>, call: ToolCall) => Promise<ToolResult>;

/** What the tools read: the engine's context, its plugins, and its store, whose database names the one org. */
export type ToolEngine = Pick<Engine, "context" | "plugins" | "store">;

/** Each tool by its name: what it runs with the arguments it declared. */
const TOOLS = new Map<string, OpenTool>([
  [
    "louvain_search_sources",
    (asked, { context, reader, pool }) => searchOrList(context, asked, reader, undefined, pool),
  ],
  ["louvain_lookup_source", (asked, { context, reader }) => lookupSource(context, reader, asked)],
  ["louvain_read_source", readOne],
]);

/** The configuration's retrievers and its reranker (one, or none), as one search pool (`search/pool.ts`). */
export const poolOf = (plugins: PluginRegistry): Pool => ({
  pool: retrieverPool(plugins.list("retriever"), plugins.list("reranker")[0]?.plugin ?? null),
});

/** The open tools over this engine: a search reads the configuration's retrievers and reranker (`search/pool.ts`). */
export function openTools(engine: ToolEngine): ToolRun {
  // Made once: with no retriever configured the start is refused, never the first search.
  const pool = poolOf(engine.plugins);
  return async (name, args) => {
    const reader = { orgId: await openOrgId(engine.store.sql), principal: OPEN_PRINCIPAL };
    const asked = toolArgs(name, args);
    const tool = TOOLS.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool(asked, { context: engine.context, reader, pool });
  };
}

/** One search as the search tool runs it, for a caller in this process (the terminal's `search`). */
export function openSearch(engine: ToolEngine) {
  const pool = poolOf(engine.plugins);
  return async (args: Record<string, unknown>) => {
    const reader = { orgId: await openOrgId(engine.store.sql), principal: OPEN_PRINCIPAL };
    return searchOrList(
      engine.context,
      toolArgs("louvain_search_sources", args),
      reader,
      undefined,
      pool,
    );
  };
}

/** One document's page by its id, at a version and an offset when asked. */
function readOne(
  asked: Record<string, unknown>,
  { context, reader }: ToolCall,
): Promise<ToolResult> {
  const id = str(asked.sourceId);
  if (!id) throw new ToolInputError("A sourceId is required.");
  return readSourcePage(context, reader, {
    id,
    version: str(asked.version) || undefined,
    offset: asked.offset,
  });
}
