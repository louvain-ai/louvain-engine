# surface-mcp

The tool server's MCP surface: the engine's three tools (search and list, look up, read) at `POST /mcp`, over the
official MCP SDK, stateless and answered as JSON (`open/mcp-protocol.ts`). It is the one surface the engine runs when
engine.config.ts names none; a configuration whose `surfaces` leaves it out serves no tools.

The server checks the read token before the route runs and hands it the reader's tools, so the surface holds no token.
