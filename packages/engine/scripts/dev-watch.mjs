#!/usr/bin/env node
/**
 * The engine, built as it is edited: `tsc --watch`, and after each compile with no errors the runtime assets are copied
 * and the source hash recorded, so a process reading `dist` runs what `src` holds and `check-engine-dist.mjs` agrees.
 */
import { spawn, spawnSync } from "node:child_process";

const tsc = spawn("npx", ["tsc", "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], {
  stdio: ["ignore", "pipe", "inherit"],
});
tsc.stdout.on("data", (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  if (/Found 0 errors\./.test(text)) {
    spawnSync(process.execPath, ["scripts/copy-runtime-assets.mjs"], { stdio: "inherit" });
    spawnSync(process.execPath, ["scripts/source-hash.mjs", "--write"], { stdio: "inherit" });
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => tsc.kill(signal));
tsc.on("exit", (code) => process.exit(code ?? 0));
