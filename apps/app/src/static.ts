import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * The page and its files, read and compressed once at start: what is on disk under `public/` and the page's compiled
 * script is the whole list of paths served, so a path can never reach past them (without a build, the page has
 * no script). Each answer is revalidated by its ETag.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

type Bytes = Uint8Array<ArrayBuffer>;
type File = { type: string; body: Bytes; gzip: Bytes | null; etag: string };

/** One file read and compressed once, as served with `type`. */
function fileOf(full: string, type: string): File {
  const body = new Uint8Array(readFileSync(full));
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
  // A font is compressed already.
  const gzip = type === "font/woff2" ? null : new Uint8Array(gzipSync(body, { level: 9 }));
  return { type, body, gzip, etag };
}

/** Every servable file under `dir`, keyed by the path it is served at: `prefix` and its place under `dir`. */
function collect(dir: string, prefix: string, into: Map<string, File>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const type = TYPES[extname(entry.name)];
    if (!entry.isFile() || !type) continue;
    const full = join(entry.parentPath, entry.name);
    into.set(`${prefix}/${relative(dir, full).split("\\").join("/")}`, fileOf(full, type));
  }
}

/** marked's own module and licence, from the installed package, at the URL the page's lexer asks for (`web/lexer.ts`). */
function markedFiles(into: Map<string, File>): void {
  const entry = createRequire(import.meta.url).resolve("marked");
  into.set("/js/vendor/marked.js", fileOf(entry, TYPES[".js"] as string));
  into.set(
    "/js/vendor/LICENSE-marked.txt",
    fileOf(join(dirname(entry), "..", "LICENSE.md"), TYPES[".txt"] as string),
  );
}

/** The answer for a file's path under the app (`/` is the page), from the files read at start. */
export function staticFiles(root: URL): (request: Request, path: string) => Response {
  const files = new Map<string, File>();
  collect(fileURLToPath(new URL("public/", root)), "", files);
  collect(fileURLToPath(new URL("dist/web/", root)), "/js", files);
  markedFiles(files);
  return (request, path) => {
    const file = files.get(path === "/" ? "/index.html" : path);
    if (!file)
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    const zipped =
      file.gzip !== null && /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
    const headers = {
      "content-type": file.type,
      etag: file.etag,
      "cache-control": "no-cache",
      vary: "accept-encoding",
      ...(zipped ? { "content-encoding": "gzip" } : {}),
    };
    if (request.headers.get("if-none-match") === file.etag)
      return new Response(null, { status: 304, headers });
    return new Response(zipped ? file.gzip : file.body, { headers });
  };
}
