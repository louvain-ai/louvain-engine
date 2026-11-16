#!/usr/bin/env node
/**
 * What the built engine was built from: a sha256 over the sources of every package the workspace builds under
 * `packages/` (each one's `src`, and `web` where it has one, its tsconfig files and its manifest), the compiler settings
 * they extend and the root lockfile, each by path and bytes in path order. A package is one the workspace file
 * (`pnpm-workspace.yaml`) names and whose manifest has a `build` script, so adding one needs no list here. The build
 * writes it to `dist/.source-hash` of the engine; a test or a dev run in the API reads the engine from `dist`, so the
 * source repository's build check recomputes it and refuses when they differ, and the open wrapper builds and restarts
 * its server by it. A content hash, not a timestamp: a checkout or a touched file does not make a stale build look
 * fresh, or a fresh one stale. A directory with no workspace around it is its own one package.
 *
 *   node scripts/source-hash.mjs --write      (from packages/engine, after tsc)
 *   node scripts/source-hash.mjs --check      (exit 0 when `dist` was built from the source as it is now)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** What a package's `tsconfig.json` extends, from the package's directory. */
const BASE_TSCONFIG = "../../tsconfig.base.json";

/** The workspace file's entries under `packages/`: `packages/*` is every directory there, else the one named. */
function workspaceDirs(root) {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return [];
  const entries = [...readFileSync(file, "utf8").matchAll(/^\s*-\s*["']?([^"'\s#]+)/gm)].map(
    (m) => m[1],
  );
  return entries
    .filter((e) => e.startsWith("packages/"))
    .flatMap((e) =>
      e.endsWith("/*")
        ? readdirSync(join(root, e.slice(0, -2)), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(root, e.slice(0, -1), d.name))
        : [join(root, e)],
    )
    .filter((dir) => {
      const manifest = join(dir, "package.json");
      return (
        existsSync(manifest) && Boolean(JSON.parse(readFileSync(manifest, "utf8")).scripts?.build)
      );
    });
}

/** The package itself, and every other package the workspace around it builds. */
function packageDirs(pkgDir) {
  return [...new Set([pkgDir, ...workspaceDirs(join(pkgDir, "../.."))])].sort();
}

const tsconfigs = (dir) =>
  readdirSync(dir)
    .filter((n) => /^tsconfig.*\.json$/.test(n))
    .sort()
    .map((n) => join(dir, n));

export function sourceHash(pkgDir) {
  const hash = createHash("sha256");
  const inputs = [];
  for (const dir of packageDirs(pkgDir))
    inputs.push(
      ...files(join(dir, "src")),
      ...files(join(dir, "web")),
      ...tsconfigs(dir),
      join(dir, "package.json"),
    );
  // The settings the tsconfigs extend and the lockfile: a change in either changes what is built. Absent in a fixture.
  inputs.push(join(pkgDir, BASE_TSCONFIG), join(pkgDir, "../..", "pnpm-lock.yaml"));
  for (const f of inputs)
    if (existsSync(f))
      hash.update(relative(pkgDir, f)).update("\0").update(readFileSync(f)).update("\0");
  return hash.digest("hex");
}

export const HASH_FILE = "dist/.source-hash";

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--write")) {
  mkdirSync(join(process.cwd(), "dist"), { recursive: true });
  writeFileSync(join(process.cwd(), HASH_FILE), `${sourceHash(process.cwd())}\n`);
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--check")) {
  const stamp = join(process.cwd(), HASH_FILE);
  const built = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : null;
  process.exitCode = built === sourceHash(process.cwd()) ? 0 : 1;
}
