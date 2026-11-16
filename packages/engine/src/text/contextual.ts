/**
 * The text a contextual vector is computed over. The chunk comes whole and last; `MAX_CONTEXT_CHARS` bounds the rest.
 * A leaf of its own so work a build does after a write (`ingest/passage-writes.ts`) rebuilds the same input without
 * importing the writer that calls it.
 */
export const contextualText = (context: string, text: string): string => `${context}\n\n${text}`;
