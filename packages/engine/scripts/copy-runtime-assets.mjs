#!/usr/bin/env node
/**
 * The files a module loads beside itself go with it into the build. `tsc` emits JavaScript only, so a JSON a module
 * reads by a path next to its own (`createRequire(import.meta.url)` of a file beside it) exists under `src` and never under
 * `dist`, and a built process silently runs without it. A package names such files in its `package.json`
 * `runtimeAssets` (paths under `src/`); its build runs this after `tsc` to copy each to the same place under `dist/`.
 * `check-runtime-assets.mjs` fails when a module loads a sibling file the list lacks.
 *
 *   node scripts/copy-runtime-assets.mjs [--out <dist dir>]     (from the package's directory)
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export function runtimeAssets(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  return pkg.runtimeAssets ?? [];
}

/** Copy each listed asset from `src/` to the same place under `out`. Returns the files written. */
export function copyRuntimeAssets(pkgDir, out = join(pkgDir, "dist")) {
  return runtimeAssets(pkgDir).map((asset) => {
    if (!asset.startsWith("src/")) throw new Error(`runtimeAssets: ${asset} is not under src/`);
    const to = join(out, relative("src", asset));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(pkgDir, asset), to);
    return to;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf("--out");
  const written = copyRuntimeAssets(process.cwd(), at >= 0 ? process.argv[at + 1] : undefined);
  console.log(`copy-runtime-assets: ${written.length} file(s) into the build`);
}
