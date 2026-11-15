import { z } from "zod";
import type { Limits } from "./contract.js";

/**
 * What one answer may spend: the person's money, so fixed limits, two of them settings within hard bounds. A value
 * outside them stops the start rather than being quietly clamped.
 */
const settings = z.object({
  LOUVAIN_APP_ASK_ROUNDS: z.coerce.number().int().min(1).max(10).default(6),
  LOUVAIN_APP_ASK_TOKENS: z.coerce.number().int().min(20_000).max(400_000).default(100_000),
});

export function limitsFrom(env: NodeJS.ProcessEnv): Limits {
  const parsed = settings.safeParse(env);
  if (!parsed.success) throw new Error(`the Ask limits: ${parsed.error.message}`);
  return {
    rounds: parsed.data.LOUVAIN_APP_ASK_ROUNDS,
    tokens: parsed.data.LOUVAIN_APP_ASK_TOKENS,
    turnTokens: 16_000,
    lookups: 12,
    readChars: 12_000,
    searchHits: 8,
    deadlineMs: 120_000,
  };
}
