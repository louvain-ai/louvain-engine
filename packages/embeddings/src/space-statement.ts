import { EMBEDDING_DIM, type EmbeddingSettings } from "./settings.js";

/** The truncation rule of transformers.js: it cuts the closing special token, as the Python sidecar does not. */
export const TRANSFORMERS_JS = "after-special-tokens";

/**
 * A space as a sidecar states it, each field kept only when it has its type: an unstated or mistyped field is absent,
 * never coerced into a value. `weights` is compared case-blind, so it is kept in lower case.
 */
export type StatedSpace = {
  model?: string;
  pooling?: string;
  dimensions?: number;
  matryoshka?: boolean;
  truncation?: string;
  weights?: string;
};

const TYPES = {
  model: "string",
  pooling: "string",
  dimensions: "number",
  matryoshka: "boolean",
  truncation: "string",
  weights: "string",
} as const;

/** A sidecar's statement (its `/healthz`, or the `space` beside its vectors) read once into a `StatedSpace`. */
export function statedSpace(raw: unknown): StatedSpace {
  const from = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(TYPES))
    if (typeof from[key] === type)
      out[key] = key === "weights" ? String(from[key]).toLowerCase() : from[key];
  return out as StatedSpace;
}

/**
 * The one space check: the fields of `expected` a stated space differs in, as "field stated ≠ expected", in
 * `expected`'s order. A field the statement leaves out takes its `defaults` value where the caller names one (a sidecar
 * that states no pooling pools by `mean`); with none it is a difference only when `strict`, since a sidecar that
 * reports less than a whole space is agreement for readiness but not for adopting a space.
 */
export function spaceDifferences(
  stated: StatedSpace,
  expected: StatedSpace,
  how: { strict: boolean; defaults?: StatedSpace },
): string[] {
  const parts: string[] = [];
  for (const key of Object.keys(expected) as (keyof StatedSpace)[]) {
    const value = stated[key] ?? how.defaults?.[key];
    if (value === undefined && !how.strict) continue;
    if (value !== expected[key])
      parts.push(`${key} ${shown(key, value)} ≠ ${shown(key, expected[key])}`);
  }
  return parts;
}

const shown = (key: keyof StatedSpace, value: unknown): string =>
  key === "weights" ? String(value || "(none)") : String(value);

/**
 * What a sidecar must state for its space to be known. Reading an unstated flag as a value records a space it may not
 * be in (a Matryoshka model recorded as "full" would mark every workspace mixed on upgrade, with no vector changed),
 * so an incomplete statement is unknown: nothing recorded, and readiness says why. Only `truncation` may go
 * unstated, since the Node sidecar does not state its rule (above).
 */
const REQUIRED = ["model", "pooling", "dimensions", "matryoshka"] as const;

/**
 * The space a model embeds in by these settings: its conventions, `EMBEDDING_DIM` and transformers.js's truncation.
 * The in-process path records it, and the Node sidecar (`apps/embeddings`), which embeds with the same `embedLocal`,
 * states it on `/healthz` and beside its vectors, as `apps/nlp` states its own.
 */
export function localSpaceStatement(mine: EmbeddingSettings): {
  model: string;
  pooling: string;
  dimensions: number;
  matryoshka: boolean;
  truncation: string;
} {
  return {
    model: mine.model,
    pooling: mine.pooling,
    dimensions: EMBEDDING_DIM,
    matryoshka: mine.matryoshka,
    truncation: TRANSFORMERS_JS,
  };
}

/** The fields a sidecar's statement lacks, or an empty list when it states a whole space. */
export function missingFromStatement(stated: Record<string, unknown>): string[] {
  const space = statedSpace(stated);
  return REQUIRED.filter((key) => space[key] === undefined);
}

/**
 * Whether a sidecar embeds the way this process expects. Its `/healthz` names its model, pooling and width; one that
 * disagrees puts every vector in a different space from the one this process queries and stores, and nothing errors,
 * so a disagreement is a reason for `/readyz` to degrade on, and `null` is agreement. A field the sidecar does not
 * report is not a disagreement (the Node sidecar reports only its width; an unreported pooling is `mean`).
 */
export function sidecarDisagreement(health: unknown, mine: EmbeddingSettings): string | null {
  const expected = { dimensions: EMBEDDING_DIM, pooling: mine.pooling, model: mine.model };
  const parts = spaceDifferences(statedSpace(health), expected, {
    strict: false,
    defaults: { pooling: "mean" },
  });
  return parts.length === 0 ? null : `embedding model mismatch: ${parts.join(", ")}`;
}
