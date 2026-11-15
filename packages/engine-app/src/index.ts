import { definePlugin, type Reading, type ReadRoute, type RoutePath } from "@louvain/engine-core";
import { limitsFrom } from "./ask/limits.js";
import { askRoute } from "./ask/route.js";
import { read, search } from "./library.js";
import { staticFiles } from "./static.js";

// The answerers a configuration names for Ask, by this package's name: `import { agent, anthropic } from "@louvain/engine-app"`.
export { agent, anthropic, scripted } from "./ask/plugins.js";

/**
 * The engine's app, Search and Ask in a browser at `/app/`, as a surface of the engine's own server. Anyone may fetch
 * the page and its files; everything under `/app/api/` reads, so it takes the browser's sign-in (or the read token).
 * Signing in, the cookie, the host and cross-site checks and the headers are the server's; each route here is a few
 * lines over the engine's own tools and the answerer the configuration names.
 */

const MOUNT = "/app";

const json = (status: number, body: unknown) => Response.json(body, { status });

/** A route that reads, for a signed-in browser. */
const reads = (
  method: ReadRoute["method"],
  path: RoutePath,
  handle: ReadRoute["handle"],
): ReadRoute => ({ method, path, needs: "read", signIn: "cookie", handle });

/** How much is loaded, and whether Ask is ready: which answerer answers, or the setting it needs. */
async function status(_request: Request, reading: Reading): Promise<Response> {
  const named = reading.answerer;
  return json(200, {
    ...(await reading.counts()),
    ask:
      named === null
        ? { ready: false }
        : named.ready
          ? { ready: true, answering: named.name }
          : { ready: false, needs: named.needs },
  });
}

async function searched(request: Request, reading: Reading): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const q = query.get("q")?.trim().slice(0, 500) ?? "";
  if (!q) return json(400, { error: "no_query" });
  const cursor = query.get("cursor") ?? undefined;
  return json(200, await search(reading.tool, { query: q, limit: 10, cursor }));
}

async function opened(request: Request, reading: Reading): Promise<Response> {
  const doc = await read(reading.tool, new URL(request.url).searchParams.get("id") ?? "");
  return doc ? json(200, doc) : json(404, { error: "not_found" });
}

export const app = definePlugin({
  kind: "surface",
  name: "app",
  create: () => {
    const files = staticFiles(new URL("..", import.meta.url));
    return {
      routes: [
        {
          method: "GET",
          path: `${MOUNT}/*`,
          needs: "none",
          handle: async (request) =>
            files(request, new URL(request.url).pathname.slice(MOUNT.length)),
        },
        // The bare mount goes to its slash, which the page's own relative paths are written against.
        {
          method: "GET",
          path: MOUNT,
          needs: "none",
          handle: async () =>
            new Response(null, { status: 308, headers: { location: `${MOUNT}/` } }),
        },
        reads("GET", `${MOUNT}/api/status`, status),
        reads("GET", `${MOUNT}/api/search`, searched),
        reads("GET", `${MOUNT}/api/document`, opened),
        reads("POST", `${MOUNT}/api/ask`, askRoute(limitsFrom(process.env))),
        // Any other data path still needs the sign-in before it is told there is nothing there.
        reads("GET", `${MOUNT}/api/*`, async () => json(404, { error: "not_found" })),
      ],
    };
  },
});
