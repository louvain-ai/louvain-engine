import type { ScoredTool } from "../../text/index.js";
import type { ServedTool } from "./mcp.js";

/**
 * The tools as the scored model saw them: the scored build's two, their descriptions and input schemas verbatim. The
 * engine's server refuses an argument it does not declare, and the scored schema declares some it does not (`app`,
 * `space`, `client`, `knownAt`, `original`, `download`), so those are removed before a call and named.
 */
export type OfferedTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** The scored tools, refused unless the server serves each by name. */
export function offeredTools(
  scored: readonly ScoredTool[],
  served: readonly ServedTool[],
): OfferedTool[] {
  const missing = scored.filter((t) => !served.some((s) => s.name === t.name)).map((t) => t.name);
  if (missing.length > 0) throw new Error(`the engine does not serve ${missing.join(", ")}`);
  // `type` first, then the schema as served: the order the scored harness sent it in.
  return scored.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: Object.assign({ type: "object" }, t.inputSchema),
  }));
}

/** The arguments the server declares, and the names of those it does not, which are left out. */
export function forServer(
  served: readonly ServedTool[],
  name: string,
  args: Record<string, unknown>,
): { args: Record<string, unknown>; stripped: string[] } {
  const declared = served.find((t) => t.name === name)?.inputSchema?.properties;
  if (!declared) return { args, stripped: [] };
  const entries = Object.entries(args);
  return {
    args: Object.fromEntries(entries.filter(([key]) => Object.hasOwn(declared, key))),
    stripped: entries.filter(([key]) => !Object.hasOwn(declared, key)).map(([key]) => key),
  };
}

/** Whether the scored schema of a tool takes an argument: the harness filled `asOf`, `question` and `exclude` only there. */
export const takes = (scored: readonly ScoredTool[], tool: string, argument: string): boolean =>
  Object.hasOwn(scored.find((t) => t.name === tool)?.inputSchema.properties ?? {}, argument);
