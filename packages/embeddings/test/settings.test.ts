import assert from "node:assert/strict";
import { test } from "node:test";
import { EmbeddingsSettings } from "../src/settings.js";

/**
 * A number setting that does not parse stops the start: unset or empty takes its default, a whole number above 0 is
 * itself, and anything else throws naming the setting, never read as 0, NaN or a fallback.
 */
const at = (name: keyof typeof EmbeddingsSettings.shape, value: string | undefined): unknown =>
  EmbeddingsSettings.shape[name].parse(value);

test("the two timeouts: default when unset or empty, themselves when whole, refused otherwise", () => {
  assert.equal(at("LOUVAIN_EMBEDDINGS_TIMEOUT_MS", undefined), 30_000);
  assert.equal(at("LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS", undefined), 180_000);
  assert.equal(at("LOUVAIN_EMBEDDINGS_TIMEOUT_MS", ""), 30_000);
  assert.equal(at("LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS", " "), 180_000);
  assert.equal(at("LOUVAIN_EMBEDDINGS_TIMEOUT_MS", "1500"), 1500);
  for (const bad of ["0", "-5", "abc", "1.5", "1e3"])
    for (const name of [
      "LOUVAIN_EMBEDDINGS_TIMEOUT_MS",
      "LOUVAIN_EMBEDDINGS_BULK_TIMEOUT_MS",
    ] as const)
      assert.throws(
        () => at(name, bad),
        new RegExp(`^.*${name} must be a whole number above 0`),
        `${name}=${bad}`,
      );
});

test("the request batch and the threads refuse the same way; the batch is capped at 256", () => {
  assert.equal(at("LOUVAIN_EMBEDDINGS_REQUEST_BATCH", undefined), 8);
  assert.equal(at("LOUVAIN_EMBEDDINGS_REQUEST_BATCH", "16"), 16);
  assert.equal(at("LOUVAIN_EMBEDDINGS_REQUEST_BATCH", "1000"), 256);
  assert.equal(at("LOUVAIN_EMBEDDINGS_THREADS", undefined), undefined);
  assert.equal(at("LOUVAIN_EMBEDDINGS_THREADS", "4"), 4);
  for (const bad of ["0", "x", "-1"]) {
    assert.throws(
      () => at("LOUVAIN_EMBEDDINGS_REQUEST_BATCH", bad),
      /LOUVAIN_EMBEDDINGS_REQUEST_BATCH must be/,
    );
    assert.throws(
      () => at("LOUVAIN_EMBEDDINGS_THREADS", bad),
      /LOUVAIN_EMBEDDINGS_THREADS must be/,
    );
  }
});
