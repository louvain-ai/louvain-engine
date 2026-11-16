# surface-mcp

The tool server's MCP surface: the engine's three tools (search and list, look up, read) at `POST /mcp`, over the
official MCP SDK, stateless and answered as JSON (`server/protocol.ts`). It is the one surface the engine runs when
engine.config.ts names none; a configuration whose `surfaces` leaves it out serves no tools.

The server checks the read token before the route runs and hands it the reader's tools, so the surface holds no token.
It serves the engine's tools as its settings make them (`Reading.tools`, answered to `tools/list`) and runs a call
through `Reading.tool`, which parses it by those same schemas: the surface never decides which tools or arguments exist.
