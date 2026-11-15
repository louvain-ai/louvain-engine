import type { One } from "./registry.js";

/**
 * A surface: routes the tool server serves. Each route needs `none`, `read` (the read token, or the browser sign-in
 * where it says `signIn: "cookie"`) or `write` (the write token alone), which the server checks; it canonicalises the
 * path, caps the body, adds the security headers, and hands a read route the reader's bound tools and a write route who
 * writes: never a token, a cookie, a store or a scope. A `GET` route also answers `HEAD`, its body left unsent.
 */
export type Surface = { readonly routes: readonly Route[] };

export type Route = OpenRoute | ReadRoute | WriteRoute;

/** A path the route answers: exact, or every path under a prefix written `/app/*`. */
export type RoutePath = `/${string}`;
type At = { readonly method: "GET" | "POST" | "DELETE"; readonly path: RoutePath };

type OpenRoute = At & { readonly needs: "none"; handle(request: Request): Promise<Response> };

export type ReadRoute = At & {
  readonly needs: "read";
  readonly signIn?: "cookie";
  handle(request: Request, read: Reading): Promise<Response>;
};

/** `maxBodyBytes`: past it the server answers 413 before the route runs. `writer` is who writes, an opaque name. */
export type WriteRoute = At & {
  readonly needs: "write";
  readonly maxBodyBytes: number;
  handle(request: Request, write: { readonly writer: string }): Promise<Response>;
};

/** One of the engine's tools as a surface serves it: the schema of its arguments is the one a call is parsed by. */
type ListedTool = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly [field: string]: unknown };
  readonly annotations: { readonly [hint: string]: unknown };
};

/** What a read route is handed: the engine's tools, counts and answerer, bound to the reader the server authenticated. */
export type Reading = {
  /** Who reads, as an opaque name: the same for one sign-in or for the read token, and never either one. */
  readonly reader: string;
  /** The answerer the configuration names: running, waiting for the setting it needs, or null when it names none. */
  readonly answerer: One<"answerer"> | null;
  /** The engine's tools as its settings make them: a surface serves them, and never decides them. */
  tools(): readonly ListedTool[];
  tool(name: string, args: Record<string, unknown>): Promise<{ readonly [field: string]: unknown }>;
  counts(): Promise<{ documents: number; collections: { name: string; documents: number }[] }>;
};
