import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** This install's tool server (`./engine up`): MCP over HTTP at `/mcp`, with the token it wrote at its start. */
export type ServedTool = { name: string; inputSchema?: { properties?: Record<string, unknown> } };
export type CallResult = { text: string; structured: unknown };
export type ToolServer = {
  list(signal: AbortSignal): Promise<ServedTool[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallResult>;
};

/** The token the environment names, else the one the server wrote to `.engine/token`. */
export function engineToken(engineRoot: string): string {
  const named = process.env.LOUVAIN_ENGINE_TOKEN?.trim();
  if (named) return named;
  const file = join(engineRoot, ".engine/token");
  if (!existsSync(file))
    throw new Error(`no engine token: ${file} does not exist (run ./engine up first)`);
  return readFileSync(file, "utf8").trim();
}

export function mcpServer(url: string, token: string): ToolServer {
  let seq = 0;
  const rpc = async (method: string, params: object, signal: AbortSignal): Promise<unknown> => {
    const res = await fetch(`${url.replace(/\/$/, "")}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
      signal,
    });
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (!res.ok || body.error)
      throw new Error(`mcp ${method}: ${res.status} ${body.error?.message ?? ""}`);
    return body.result;
  };
  return {
    list: async (signal) =>
      ((await rpc("tools/list", {}, signal)) as { tools: ServedTool[] }).tools,
    call: async (name, args, signal) => {
      const r = (await rpc("tools/call", { name, arguments: args }, signal)) as {
        content?: { text?: string }[];
        structuredContent?: unknown;
      };
      return {
        text: (r.content ?? []).map((c) => c.text ?? "").join("\n"),
        structured: r.structuredContent,
      };
    },
  };
}
