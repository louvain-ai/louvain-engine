/**
 * A saved email (`.eml`) as the mail a person would read in it: its header block, its body (the plain part, else the
 * HTML part as text) and the names of what was attached, never their bytes. `postal-mime` (pinned at its linear
 * release) owns MIME; its bytes are capped first, its own limits passed explicitly (`email-limits.ts`), a limit
 * reached is too large, and the parse runs in a reader process killed at its deadline.
 */

import {
  MAX_EMAIL_BYTES,
  MAX_EMAIL_FORWARDS,
  MAX_EMAIL_HEADERS,
  MAX_EMAIL_NESTING,
} from "./email-limits.js";
import { inWorker, siblingModule } from "./worker.js";
import { WorkerDeadline, WorkerFailed, WorkerOutOfMemory } from "./worker-errors.js";

export class EmailRefused extends Error {}
export class EmailDeadline extends Error {
  constructor() {
    super("Reading the email took too long");
  }
}

export async function emailText(
  bytes: Uint8Array,
  deadline: number,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  if (bytes.byteLength > MAX_EMAIL_BYTES)
    throw new EmailRefused(
      `The email is ${Math.round(bytes.byteLength / 1_048_576)} MB; an email is read up to ${MAX_EMAIL_BYTES / 1_048_576} MB`,
    );
  try {
    return await inWorker(
      siblingModule("email-worker", import.meta.url),
      {
        bytes,
        limits: {
          maxNestingDepth: MAX_EMAIL_NESTING,
          maxHeadersSize: MAX_EMAIL_HEADERS,
          maxRfc822NestingDepth: MAX_EMAIL_FORWARDS,
        },
      },
      { deadline: deadline },
    );
  } catch (error) {
    if (error instanceof WorkerDeadline) throw new EmailDeadline();
    if (error instanceof WorkerOutOfMemory) throw new EmailRefused(error.message);
    // The library's own limits, reached: a refusal of the file's size or shape, not a damaged file.
    if (
      error instanceof WorkerFailed &&
      /Maximum (MIME nesting depth|header size)/.test(error.message)
    )
      throw new EmailRefused(error.message);
    throw error;
  }
}
