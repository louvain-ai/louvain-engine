import type { Engine } from "../../engine.js";
import type { ReadContext } from "../../read/fence.js";
import type { SearchWith } from "../../search/document.js";
import { retrieverPool } from "../../search/pool.js";
import { OPEN_PRINCIPAL, workspaceIdOnce } from "../../store/tenant.js";
import type { ToolResult, ToolRun } from "../protocol.js";
import { str, ToolInputError } from "./arguments.js";
import { toolArgs } from "./input.js";
import { lookupSource } from "./lookup.js";
import { readSourcePage } from "./read-page.js";
import { listedTools } from "./schema.js";
import { searchOrList } from "./search-apps.js";

/**
 * The tools a request names, run as the engine's one reader (`org.ts`) on the engine's read context, each on its
 * arguments parsed once by the schema `tools/list` serves (`tool-input.ts`): an undeclared or wrong argument is refused
 * with a sentence, never dropped.
 */
type ReaderId = { orgId: string; principal: string };
type Pool = SearchWith;
/** What a tool call runs on: the engine's read context, the one reader, and the search pool. */
type ToolCall = { context: ReadContext; reader: ReaderId; pool: Pool };
type OpenTool = (asked: Record<string, unknown>, call: ToolCall) => Promise<ToolResult>;

/** What the tools read: the engine's context, plugins and settings, and its store, whose database names the one org. */
export type ToolEngine = Pick<Engine, "context" | "plugins" | "store" | "settings">;

/** Each tool by its name: what it runs with the arguments it declared. */
const TOOLS: ReadonlyMap<string, OpenTool> = new Map([
  [
    "louvain_search_sources",
    (asked, { context, reader, pool }) => searchOrList(context, asked, reader, undefined, pool),
  ],
  ["louvain_lookup_source", (asked, { context, reader }) => lookupSource(context, reader, asked)],
  ["louvain_read_source", readOne],
]);

/** The configuration's retrievers and its reranker (one, or none), as one search pool (`search/pool.ts`). */
export const poolOf = ({ plugins, settings }: Pick<Engine, "plugins" | "settings">): Pool => ({
  pool: retrieverPool(plugins.list("retriever"), plugins.list("reranker")[0]?.plugin ?? null),
  settings,
});

/** The open tools over this engine: a search reads the configuration's retrievers and reranker (`search/pool.ts`). */
export function openTools(engine: ToolEngine): ToolRun {
  // Made once: with no retriever configured the start is refused, never the first search.
  const pool = poolOf(engine);
  const orgId = workspaceIdOnce(engine.store.sql);
  return async (name, args) => {
    const reader = { orgId: await orgId(), principal: OPEN_PRINCIPAL };
    const asked = toolArgs(name, args, engine.settings);
    const tool = TOOLS.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool(asked, { context: engine.context, reader, pool });
  };
}

/** One search as the search tool runs it, for a caller in this process (the terminal's `search`). */
export function openSearch(engine: ToolEngine) {
  const pool = poolOf(engine);
  const orgId = workspaceIdOnce(engine.store.sql);
  return async (args: Record<string, unknown>) => {
    const reader = { orgId: await orgId(), principal: OPEN_PRINCIPAL };
    return searchOrList(
      engine.context,
      toolArgs("louvain_search_sources", args, engine.settings),
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

/** The tools this engine serves, by its settings: what a surface lists (`Reading.tools`) and what `toolArgs` parses by. */
export const toolList = (engine: Pick<Engine, "settings">) => listedTools(engine.settings);
