#!/usr/bin/env node
/**
 * A package's tests, or a failure saying there are none: every engine package's `test` script runs through this, so a
 * pattern that matches no file fails instead of `node --test` reporting "tests 0" and passing (an address guard once
 * shipped with no tests and a green `pnpm test`).
 *
 *   node ../../scripts/run-tests.mjs [node --test flags] -- test/*.test.ts [more patterns]
 *
 * The shell expands each pattern before this runs; a pattern that matched nothing reaches it as written, which is no
 * file, and fails naming it. The files then run under `node --import tsx --test` with the flags given.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const flags = split === -1 ? [] : args.slice(0, split);
const files = split === -1 ? args : args.slice(split + 1);

const missing = files.filter((file) => !existsSync(file));
if (files.length === 0 || missing.length > 0) {
  const named = missing.length > 0 ? missing.join(", ") : "(no pattern given)";
  console.error(`run-tests: no test file matches ${named}`);
  process.exit(1);
}

const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...flags, ...files], {
  stdio: "inherit",
});
process.exit(run.status ?? 1);
