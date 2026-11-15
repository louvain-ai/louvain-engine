import assert from "node:assert/strict";
import { test } from "node:test";
import { EmbeddingFailed, EmbeddingUnavailable } from "@louvain/embeddings";
import { isUnreachable } from "../src/unreachable.js";

/**
 * A LANE THAT IS DOWN IS NOT WORK THAT IS WRONG: an embedding sidecar that could not answer is known by its type, also
 * when another error wraps it, and a socket that could not connect by the platform's own codes. Anything else is the
 * work's fault.
 */
test("an unavailable embedding sidecar is unreachable, wrapped or not", () => {
  const down = new EmbeddingUnavailable({ cause: new TypeError("fetch failed") });
  assert.equal(isUnreachable(down), true);
  assert.equal(isUnreachable(new Error("index job failed", { cause: down })), true);
});

test("a socket that could not connect is unreachable; a bad answer is not", () => {
  assert.equal(isUnreachable(new Error("connect ECONNREFUSED 127.0.0.1:8091")), true);
  assert.equal(
    isUnreachable(new EmbeddingFailed("embeddings: malformed response", "malformed")),
    false,
  );
  assert.equal(isUnreachable(new Error("bad input")), false);
});
