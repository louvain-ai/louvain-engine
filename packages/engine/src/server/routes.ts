/**
 * The tool server's route table, made once from its own routes and the configured surfaces: a path is exact, or every
 * path under a prefix written `/app/*`. Two routes on one method and path, or two owners answering one path, stop the
 * start, naming them, so the order surfaces are listed in never decides which one answers.
 */
import type { Route, Surface } from "@louvain/engine-core";

export class RouteClash extends Error {}

export type RouteTable = {
  /** The route for this method and path; the methods allowed when routes answer the path but not this one; or null. */
  match(method: string, path: string): Route | { allow: readonly string[] } | null;
  /** Every route's path, in the order the surfaces declared them. */
  readonly paths: readonly string[];
};

export function routeTable(surfaces: readonly { name: string; plugin: Surface }[]): RouteTable {
  const owners = new Map<string, string>();
  const routes: { route: Route; owner: string }[] = [];
  for (const { name, plugin } of surfaces)
    for (const route of plugin.routes) {
      const key = `${route.method} ${route.path}`;
      const held = owners.get(key);
      if (held) throw new RouteClash(`the surfaces "${held}" and "${name}" both declare ${key}`);
      // A path is one owner's: another's route on it, or a prefix over it, would answer in its place.
      const other = routes.find((r) => r.owner !== name && overlaps(r.route, route));
      if (other)
        throw new RouteClash(
          `the surfaces "${other.owner}" and "${name}" both answer ${route.path} (${other.route.path})`,
        );
      owners.set(key, name);
      routes.push({ route, owner: name });
    }
  return {
    match(method, path) {
      // The most specific route answers: an exact path before any prefix, a longer prefix before a shorter one.
      const here = routes
        .map((r) => r.route)
        .filter((route) => covers(route, path))
        .sort((a, b) => reach(a) - reach(b));
      if (here.length === 0) return null;
      return here.find((route) => route.method === method) ?? { allow: here.map((r) => r.method) };
    },
    paths: routes.map((r) => r.route.path),
  };
}

const prefix = (route: Route): boolean => route.path.endsWith("/*");

const covers = (route: Route, path: string): boolean =>
  prefix(route) ? path.startsWith(stem(route)) : path === route.path;

/** The path a route starts at: its exact path, or its prefix without the `*`. */
const stem = (route: Route): string => (prefix(route) ? route.path.slice(0, -1) : route.path);

/** Whether two routes answer a path in common. */
const overlaps = (a: Route, b: Route): boolean => covers(a, stem(b)) || covers(b, stem(a));

/** How much a route covers: an exact path covers least, then the longer prefix. */
const reach = (route: Route): number =>
  prefix(route) ? -route.path.length : Number.MIN_SAFE_INTEGER;
