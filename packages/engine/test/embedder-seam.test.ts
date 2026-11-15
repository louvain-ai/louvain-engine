import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbedder, EmbeddingsSettings } from "@louvain/embeddings";
import { bindEmbedder, EmbedderUnbound, embed, embedder } from "../src/embedder.js";

/**
 * THE PROCESS'S EMBEDDER IS BOUND ONCE. This process loads no build's binding (`check-engine-boundary.mjs`
 * `BINDING_TESTS`): unbound an embed throws; bound, the engine's functions are that embedder's; the same again is a
 * no-op and a different one is refused.
 */
test("the embedder: unbound throws, bound once, a different one refused", async () => {
  assert.throws(() => embedder(), EmbedderUnbound);
  await assert.rejects(() => embed(["x"]), EmbedderUnbound);
  const mine = createEmbedder(EmbeddingsSettings.parse({}));
  bindEmbedder(mine);
  bindEmbedder(mine);
  assert.equal(embedder(), mine);
  assert.deepEqual(await embed([]), [], "the bound embedder's, which sends nothing for nothing");
  assert.throws(() => bindEmbedder(createEmbedder(EmbeddingsSettings.parse({}))), /already bound/);
});
