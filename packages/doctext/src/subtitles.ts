/**
 * A transcript or subtitle file, read in a process of its own (`worker.ts`): the parser (`subtitles-read.ts`)
 * is linear, but a hostile file at the input cap can still hold a process for a long time, so the reader's process
 * holds the deadline and the heap, as a calendar's and an email's do.
 */

import { inWorker, siblingModule } from "./worker.js";
import { WorkerDeadline, WorkerOutOfMemory } from "./worker-errors.js";

/** Bytes read per character kept: a real transcript's timing lines and tags are three to six times its words. */
export const SUBTITLE_BYTES_PER_CHAR = 8;

export class SubtitlesRefused extends Error {}
export class SubtitlesDeadline extends Error {
  constructor() {
    super("Reading the transcript took too long");
  }
}

export async function subtitlesText(
  source: string,
  maxChars: number,
  deadline: number,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  try {
    return await inWorker(
      siblingModule("subtitles-worker", import.meta.url),
      { source, maxChars },
      { deadline: deadline },
    );
  } catch (error) {
    if (error instanceof WorkerDeadline) throw new SubtitlesDeadline();
    if (error instanceof WorkerOutOfMemory) throw new SubtitlesRefused(error.message);
    throw error;
  }
}
