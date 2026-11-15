import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The engine's one door opens nothing. A process with an empty environment (`env -i`) imports `@louvain/engine` by
 * its package name, as a configuration does, so it reads the package's built `dist` through its one `exports` entry,
 * and nothing it loads leaves anything open: no pool, socket, timer or server it did not have before the import, and the
 * process ends on its own.
 */
const here = join(import.meta.dirname, "..");

// The process's own stdio, made before it is measured: a module touching a standard stream at load (as the MCP SDK
// does) adds the stream the process has anyway, which holds nothing open.
const child = `
void process.stdin, process.stdout, process.stderr;
const before = process.getActiveResourcesInfo();
const door = await import("@louvain/engine");
const after = process.getActiveResourcesInfo();
const opened = [...after];
for (const r of before) {
  const at = opened.indexOf(r);
  if (at >= 0) opened.splice(at, 1);
}
console.log(JSON.stringify({ opened, names: Object.keys(door).sort() }));
`;

test("importing @louvain/engine in an empty environment opens nothing and ends on its own", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
    cwd: here,
    env: {},
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(run.signal, null, `it did not end on its own: ${run.stderr}`);
  assert.equal(run.status, 0, run.stderr);
  const { opened, names } = JSON.parse(run.stdout.trim()) as { opened: string[]; names: string[] };
  assert.deepEqual(opened, [], "nothing open that was not open before the import");
  for (const name of [
    "createEngine",
    "openStore",
    "startToolServer",
    "ingestFrom",
    "folder",
    "mcp",
  ])
    assert.ok(names.includes(name), `the door offers ${name}`);
});
