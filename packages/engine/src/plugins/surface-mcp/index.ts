import { definePlugin } from "@louvain/engine-core";
import { mcpRoute } from "../../open/mcp-protocol.js";

/** MCP as a surface: the engine's tools at `POST /mcp`, behind the read token, run for the reader the server checked. */
export const mcp = definePlugin({
  kind: "surface",
  name: "mcp",
  create: () => ({
    routes: [
      {
        method: "POST",
        path: "/mcp",
        needs: "read",
        handle: (request, read) => mcpRoute(read.tool).handle(request),
      },
    ],
  }),
});
