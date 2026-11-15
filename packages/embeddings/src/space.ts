import { createHash } from "node:crypto";
import type { RemoteClient } from "./remote.js";
import { EMBEDDING_DIM, type EmbeddingSettings } from "./settings.js";
import { localSpaceStatement, missingFromStatement, TRANSFORMERS_JS } from "./space-statement.js";

/**
 * Which space this process's stored vectors are in: the identity of whatever produces them (the bulk sidecar when one
 * is configured, else the in-process path) as one comparable string. Producers that disagree write vectors that must
 * not be compared. The space is read freshest first: the last `/embed` statement, then the lane's `/healthz` (reread
 * after `STALE_MS`), then the in-process settings. The truncation rule is part of it; the query instruction is not.
 */
export type EmbeddingSpace = {
  fingerprint: string;
  detail: {
    producer: "sidecar" | "in-process";
    model: string;
    pooling: string;
    dimensions: number;
    matryoshka: boolean;
    truncation: string;
    queryInstruction: string;
  };
};

const STALE_MS = 60_000;

/** The embedder's space as it reads it now: one per embedder, with its own probe cache. */
export function createSpace(remote: RemoteClient, model: () => EmbeddingSettings) {
  let probed: { at: number; space: Record<string, unknown> } | null = null;
  /** What the sidecar's most recent statement left out, or null when it stated a whole space. */
  let unstated: string[] | null = null;

  /** A sidecar's statement as a space, or null when it does not state a whole one (and `unstated` says what it lacks). */
  function stated(statement: Record<string, unknown>): EmbeddingSpace | null {
    const missing = missingFromStatement(statement);
    unstated = missing.length > 0 ? missing : null;
    return missing.length > 0 ? null : spaceOf(statement, "sidecar");
  }

  function spaceOf(
    stated: Record<string, unknown>,
    producer: EmbeddingSpace["detail"]["producer"],
  ): EmbeddingSpace {
    const detail: EmbeddingSpace["detail"] = {
      producer,
      model: typeof stated.model === "string" ? stated.model : "unknown",
      pooling: typeof stated.pooling === "string" ? stated.pooling : "mean",
      dimensions: typeof stated.dimensions === "number" ? stated.dimensions : EMBEDDING_DIM,
      matryoshka: stated.matryoshka === true,
      truncation: typeof stated.truncation === "string" ? stated.truncation : TRANSFORMERS_JS,
      queryInstruction: createHash("sha256")
        .update(model().queryInstruction)
        .digest("hex")
        .slice(0, 12),
    };
    return {
      fingerprint: [
        detail.model,
        detail.pooling,
        detail.dimensions,
        detail.matryoshka ? "mrl" : "full",
        detail.truncation,
      ].join("|"),
      detail,
    };
  }

  /**
   * The producing space, or null when the bulk sidecar is configured, has stated nothing and does not answer (nothing
   * to record yet). `fresh` skips both the stated space and the probe cache: a readiness check reads the embedder now.
   */
  async function space(opts: { fresh?: boolean } = {}): Promise<EmbeddingSpace | null> {
    // An on-demand or wake-on-request bulk lane is never probed (a probe would start it): its space is the one its last
    // job stated, unknown until a job has run, and unknown is nothing to record, not a disagreement. It is checked first
    // because the lane is the producer even where queries embed in process.
    if (remote.bulkOnDemand() || remote.laneWakesOnRequest("bulk")) {
      const last = remote.lastStatedBulkSpace();
      return last ? stated(last) : null;
    }
    if (!remote.remoteConfigured()) {
      unstated = null;
      return spaceOf(localSpaceStatement(model()), "in-process");
    }
    if (!opts.fresh) {
      const last = remote.lastStatedBulkSpace();
      if (last) return stated(last);
      if (probed && Date.now() - probed.at < STALE_MS) return stated(probed.space);
    }
    const h = await remote.sidecarHealthz("bulk");
    if (!h) return null;
    probed = { at: Date.now(), space: h };
    return stated(h);
  }

  return {
    space,
    /** The fields the bulk sidecar's last statement lacked, when that is why the space is unknown; null otherwise. */
    spaceUnstated: (): string[] | null => unstated,
  };
}
