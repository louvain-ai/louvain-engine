import type { Embedder } from "@louvain/embeddings";

/**
 * THE ENGINE'S EMBEDDER, as its reads and writes reach it: `createEngine` puts its own (`EngineParts.embedder`) among
 * the hooks of the context and the writes it makes, and a read or a write that embeds asks `embedderOf`, never a
 * process binding. A build never passes one: it is the engine's part, not something a build adds.
 */
export class EmbedderUnbound extends Error {
  constructor() {
    super(
      "no embedder in this read's or write's hooks: a context or writes made by createEngine carry its embedder",
    );
    this.name = "EmbedderUnbound";
  }
}

/** The member `createEngine` adds to the hooks it hands a read and a write. */
export type Embedded = { readonly embedder?: Embedder };

/** The embedder a read's context or a write's writes carry; without one, nothing embeds (`EmbedderUnbound`). */
export function embedderOf(on: { readonly hooks?: Embedded | undefined }): Embedder {
  const embedder = on.hooks?.embedder;
  if (embedder === undefined) throw new EmbedderUnbound();
  return embedder;
}
