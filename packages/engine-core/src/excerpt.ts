/**
 * HOW MUCH OF A SOURCE A ROW CARRIES, when it is less than all of it.
 *
 * `shown` and `total` are characters of the source's own text. `ingest` is set when the
 * text the engine holds is itself a cut reading of the source — a file its reader read
 * only to its character cap (`presentation.document.truncated`), or a source listing
 * capped at 100,000 characters (`source_revision.content_truncated`) — because then even a
 * row shown whole is not the whole source.
 */
export type Clip = { shown: number; total: number; ingest?: boolean };
