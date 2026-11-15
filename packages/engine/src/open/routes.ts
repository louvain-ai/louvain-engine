/**
 * The tool server's route table, made once from the configured surfaces: a path is exact, or every path under a prefix
 * written `/app/*`. Two routes on one method and path, or a route on a path the server keeps for itself, stop the
 * start, naming them, so the order surfaces are listed in never decides which one answers.
 */
import type { Route, Surface } from "@louvain/engine-core";

/** The paths the server answers itself: the write door and the browser's sign-in. */
const SERVER_PATHS = ["/ingest", "/session"];

export class RouteClash extends Error {}

export type RouteTable = {
  /** The route for this method and path; the methods allowed when routes answer the path but not this one; or null. */
  match(method: string, path: string): Route | { allow: readonly string[] } | null;
  /** Every route's path, in the order the surfaces declared them. */
  readonly paths: readonly string[];
  /** Whether any route takes the browser sign-in, which opens the server's own at `/session`. */
  readonly signsIn: boolean;
};

export function routeTable(surfaces: readonly { name: string; plugin: Surface }[]): RouteTable {
  const owners = new Map<string, string>();
  const routes: Route[] = [];
  for (const { name, plugin } of surfaces)
    for (const route of plugin.routes) {
      const key = `${route.method} ${route.path}`;
      const held = owners.get(key);
      if (held) throw new RouteClash(`the surfaces "${held}" and "${name}" both declare ${key}`);
      if (SERVER_PATHS.some((own) => covers(route, own)))
        throw new RouteClash(`the surface "${name}" declares ${key}, a path the server keeps`);
      owners.set(key, name);
      routes.push(route);
    }
  return {
    match(method, path) {
      // The most specific route answers: an exact path before any prefix, a longer prefix before a shorter one.
      const here = routes
        .filter((route) => covers(route, path))
        .sort((a, b) => reach(a) - reach(b));
      if (here.length === 0) return null;
      return here.find((route) => route.method === method) ?? { allow: here.map((r) => r.method) };
    },
    paths: routes.map((route) => route.path),
    signsIn: routes.some((route) => route.needs === "read" && route.signIn === "cookie"),
  };
}

const prefix = (route: Route): boolean => route.path.endsWith("/*");

const covers = (route: Route, path: string): boolean =>
  prefix(route) ? path.startsWith(route.path.slice(0, -1)) : path === route.path;

/** How much a route covers: an exact path covers least, then the longer prefix. */
const reach = (route: Route): number =>
  prefix(route) ? -route.path.length : Number.MIN_SAFE_INTEGER;
