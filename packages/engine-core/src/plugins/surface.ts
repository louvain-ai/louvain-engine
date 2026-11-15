import type { One } from "./registry.js";

/**
 * A surface: routes the tool server serves. Each route says what it needs, `none` or `read` (the read token, or the
 * server's browser sign-in where it says `signIn: "cookie"`). The server checks that, canonicalises the path, caps the
 * body and adds the security headers before `handle` runs, and hands a read route the reader's bound tools: never a
 * token, a cookie, a store or a scope. A `GET` route also answers `HEAD`, its body left unsent.
 */
export type Surface = { readonly routes: readonly Route[] };

export type Route = OpenRoute | ReadRoute;

/** A path the route answers: exact, or every path under a prefix written `/app/*`. */
export type RoutePath = `/${string}`;
export type RouteMethod = "GET" | "POST";

export type OpenRoute = {
  readonly method: RouteMethod;
  readonly path: RoutePath;
  readonly needs: "none";
  handle(request: Request): Promise<Response>;
};

export type ReadRoute = {
  readonly method: RouteMethod;
  readonly path: RoutePath;
  readonly needs: "read";
  readonly signIn?: "cookie";
  handle(request: Request, read: Reading): Promise<Response>;
};

/** What a read route is handed: the engine's tools, counts and answerer, bound to the reader the server authenticated. */
export type Reading = {
  /** Who reads, as an opaque name: the same for one sign-in or for the read token, and never either one. */
  readonly reader: string;
  /** The answerer the configuration names: running, waiting for the setting it needs, or null when it names none. */
  readonly answerer: One<"answerer"> | null;
  tool(name: string, args: Record<string, unknown>): Promise<{ readonly [field: string]: unknown }>;
  counts(): Promise<{ documents: number; collections: { name: string; documents: number }[] }>;
};
