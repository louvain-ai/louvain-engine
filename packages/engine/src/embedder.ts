import type { Embedder, EmbedLane } from "@louvain/embeddings";

/**
 * THE PROCESS'S ONE EMBEDDER, bound once: the reads and writes that embed still ask this binding, not the engine they
 * run under, so an entry binds the embedder its engine holds (`bindEmbedder(engine.embedder)`), the one value both
 * see. Unbound, an embed throws. The functions below are the bound embedder's, so a caller names what it does, not
 * which instance does it; unbound, each rejects like any failed embed.
 */
export class EmbedderUnbound extends Error {
  constructor() {
    super(
      "no embedder is bound; an entry binds its engine's embedder (bindEmbedder(engine.embedder)) before anything embeds",
    );
    this.name = "EmbedderUnbound";
  }
}

let bound: Embedder | undefined;

/** Fix this process's embedder. The same again is a no-op; a different one throws. */
export function bindEmbedder(e: Embedder): void {
  if (bound === e) return;
  if (bound !== undefined)
    throw new Error("a different embedder is already bound: a process binds one, once");
  bound = e;
}

/** The bound embedder. */
export function embedder(): Embedder {
  if (bound === undefined) throw new EmbedderUnbound();
  return bound;
}

export const embed = async (texts: string[], lane?: EmbedLane): Promise<number[][]> =>
  embedder().embed(texts, lane);
export const embedQuery = async (text: string): Promise<number[]> => embedder().embedQuery(text);
export const embeddingSettings = () => embedder().settings();
export const remoteTokenCounts = async (texts: string[]): Promise<number[]> =>
  embedder().remoteTokenCounts(texts);
export const embeddingSpace = async (opts?: { fresh?: boolean }) => embedder().space(opts);
