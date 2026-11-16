import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

/**
 * The BM25 group commit (`kg/read/bm25.ts`): a burst of index jobs shares a commit, a job never rides a
 * commit that started before its document was added, and a failed commit fails only the jobs that were waiting on it.
 */
test("a burst shares commits; a late arrival waits for the next; a failure is its own waiters'", async () => {
  const commits: number[] = [];
  let failNext = false;
  /** Told when the sidecar RECEIVES a commit: the moment a job arriving later may no longer ride it (no clock). */
  let onCommit: (() => void) | null = null;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { commit?: boolean };
      if (body.commit === false)
        return void res.end(JSON.stringify({ indexed: 1, committed: false }));
      const started = commits.length;
      onCommit?.();
      setTimeout(() => {
        if (failNext) {
          failNext = false;
          res.statusCode = 500;
          return void res.end("{}");
        }
        commits.push(started);
        res.end(JSON.stringify({ indexed: 0, committed: true }));
      }, 40);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOUVAIN_BM25_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { bm25 } = await import("../src/kg/read/bm25.js");
  try {
    // Ten jobs at once: the first commits now, the other nine share ONE following commit.
    await Promise.all(Array.from({ length: 10 }, () => bm25.groupCommit()));
    assert.equal(commits.length, 2, "ten waiters, two commits");

    // Alone, a job commits at once, as before.
    await bm25.groupCommit();
    assert.equal(commits.length, 3);

    // A job that arrives while a commit runs waits for one that started AFTER it arrived.
    const before = commits.length;
    const received = new Promise<void>((r) => {
      onCommit = r;
    });
    const first = bm25.groupCommit();
    await received;
    onCommit = null;
    const late = bm25.groupCommit();
    await Promise.all([first, late]);
    assert.equal(
      commits.length,
      before + 2,
      "the late job did not ride the commit already under way: it had one of its own",
    );

    // A failed commit rejects its own waiters; the next group still commits.
    failNext = true;
    const failing = bm25.groupCommit();
    const next = bm25.groupCommit();
    await assert.rejects(failing);
    await next;
    assert.equal(commits.length, 6);
  } finally {
    server.close();
  }
});

test("an add and its commit from different sidecar processes are a restart: the job retries (Tier 2 review, SF1)", async () => {
  let boot: string | undefined = "boot-a";
  let restartAfterAdd = false;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { commit?: boolean };
      const answer = { indexed: 0, committed: body.commit !== false, ...(boot ? { boot } : {}) };
      res.end(JSON.stringify(answer));
      // The sidecar restarts after taking the uncommitted add: the add dies with the old process.
      if (body.commit === false && restartAfterAdd) boot = boot ? `${boot}-restarted` : undefined;
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOUVAIN_BM25_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { bm25, Bm25Restarted, resetBm25Settings } = await import("../src/kg/read/bm25.js");
  resetBm25Settings();
  const doc = {
    id: "e1",
    org: "o1",
    container: "c",
    occurredAt: new Date().toISOString(),
    text: "x",
  };
  try {
    await bm25.indexDurably([doc]);
    restartAfterAdd = true;
    await assert.rejects(
      bm25.indexDurably([doc]),
      Bm25Restarted,
      "the add was lost with the old process",
    );
    restartAfterAdd = false;
    await bm25.indexDurably([doc]);
    // A sidecar too old to say which process it is: trusted as before.
    boot = undefined;
    await bm25.indexDurably([doc]);
  } finally {
    server.close();
  }
});
