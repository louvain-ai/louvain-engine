/**
 * How much a read may spend (the engine's mode table, `memory/modes.ts`). `normal` is the deployment's configured
 * defaults; `fast` reads the first page once; `thorough` reads more documents whole and their neighbours. Every mode
 * reads the same fenced corpus: a mode changes cost and completeness, never what the reader may see.
 */
export type AskMode = "fast" | "normal" | "thorough";
/** A record card's bounds (`presentation.record`): what a mapper clips to before sending. */
export const RECORD_FIELDS_MAX = 40;
export const RECORD_LABEL_MAX = 80;
export const RECORD_VALUE_MAX = 500;
/** Source links are data, never executable URLs or authenticated server fetches. */
export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
/**
 * The ways a document arrives that make it generated: an agent wrote it (`agent`) or
 * the system wrote a version for a person (`assistant`). Generated text is read for passages only, folds into
 * nothing and is labelled wherever it is shown. EVERY check of "was this generated" goes through this list —
 * in TypeScript `isGeneratedVia`, in SQL `= any(GENERATED_VIAS)` — because a check that names one value is
 * how a second writer's text becomes knowledge.
 */
export const GENERATED_VIAS = ["agent", "assistant"] as const;
/** Which record, in a source: the identity pair every record key spells. */
export type RecordRef = { objectType: string; nativeId: string };
/**
 * A record's key, as it is stored and listed: `<objectType>:<nativeId>`. `objectType` cannot contain `:` (the contract
 * refuses it), so the first colon separates the halves, and a native id may hold as many as it likes.
 */
export const keyOfRecord = (r: RecordRef): string => `${r.objectType}:${r.nativeId}`;
