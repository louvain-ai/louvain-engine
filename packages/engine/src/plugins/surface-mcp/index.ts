import { definePlugin } from "@louvain/engine-core";
import { engineVersion, mcpRoute } from "../../open/mcp-protocol.js";

/** MCP as a surface: the engine's tools at `POST /mcp`, behind the read token, run for the reader the server checked. */
export const mcp = definePlugin({
  kind: "surface",
  name: "mcp",
  create: () => {
    // Read once, when the surface is made: every request answers with the version its package declares.
    const version = engineVersion();
    return {
      routes: [
        {
          method: "POST",
          path: "/mcp",
          needs: "read",
          handle: (request, read) => mcpRoute(read, version).handle(request),
        },
      ],
    };
  },
});
