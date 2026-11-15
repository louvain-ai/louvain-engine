#!/usr/bin/env node
/**
 * The build starts from nothing. `tsc` writes what the source holds and deletes nothing, so a module removed or renamed
 * in `src` would stay importable from `dist` under its old name, and a caller of it would keep passing against code that
 * no longer exists. A package's build removes its `dist` first, and any incremental build info beside its tsconfig, so
 * `tsc` cannot skip an emit it believes is already there. Every package's `build` starts with this one script.
 *
 *   node ../../scripts/clean-dist.mjs      (from a package's directory)
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.cwd();
rmSync(join(dir, "dist"), { recursive: true, force: true });
for (const name of readdirSync(dir))
  if (name.endsWith(".tsbuildinfo")) rmSync(join(dir, name), { force: true });
