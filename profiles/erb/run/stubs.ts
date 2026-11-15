import type { ScoredTool } from "../text/index.js";
import type { KeyResolver } from "./keys.js";
import type { Block, Model } from "./model.js";
import type { ToolServer } from "./tools/mcp.js";

/**
 * The dry run's stand-ins: no key, no money, no engine. The model searches and reads in turn until it has done three
 * of each, then answers citing the first document returned, so the loop, the injections and the citation mapping run.
 */
export function stubModel(): Model {
  let calls = 0;
  return async (turn) => {
    const blocks = turn.messages.flatMap((m) => m.content);
    const done = blocks.filter((b) => b.type === "tool_use").length;
    const seen = blocks.flatMap((b) =>
      b.type === "tool_result" && typeof b.content === "string"
        ? [...b.content.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1] ?? "")
        : [],
    );
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (turn.final || done >= 6)
      return {
        content: [{ type: "text", text: `A stub answer [src:${seen[0] ?? "none"}].` }],
        usage,
      };
    calls += 1;
    const search = done % 2 === 0;
    const content: Block[] = [
      {
        type: "tool_use",
        id: `call_${calls}`,
        name: search ? "louvain_search_sources" : "louvain_read_source",
        input: search ? { query: `stub query ${done}` } : { sourceId: seen.at(-1) ?? "none" },
      },
    ];
    return { content, usage };
  };
}

/** Both scored tools under the engine's own arguments; each search lists three new documents. */
export function stubServer(scored: readonly ScoredTool[]): ToolServer {
  let searches = 0;
  const search = [
    "query",
    "question",
    "mode",
    "after",
    "before",
    "limit",
    "exclude",
    "view",
    "cursor",
    "asOf",
  ];
  const read = ["sourceId", "version", "offset"];
  const declared = (names: string[]) => Object.fromEntries(names.map((n) => [n, {}]));
  return {
    list: async () =>
      scored.map((t) => ({
        name: t.name,
        inputSchema: { properties: declared(t.name === "louvain_read_source" ? read : search) },
      })),
    call: async (name, args) => {
      if (name === "louvain_read_source") {
        const value = { id: String(args.sourceId), title: "A stub document", text: "stub text" };
        return { text: JSON.stringify(value), structured: value };
      }
      if (name !== "louvain_search_sources")
        throw new Error(`mcp tools/call: 200 unknown tool: ${name}`);
      searches += 1;
      const value = {
        sources: [1, 2, 3].map((n) => ({ id: `stub-${searches}-${n}`, title: `Stub ${n}` })),
      };
      return { text: JSON.stringify(value), structured: value };
    },
  };
}

/** A stub id stands for a stub document's dsid. */
export const stubKeys = (): KeyResolver => async (ids) =>
  new Map(
    ids.map((id) => [
      id,
      `dsid_${id
        .replace(/[^0-9a-z]/g, "")
        .padEnd(32, "0")
        .slice(0, 32)}`,
    ]),
  );
