import { classify } from "../src/classify.js";
import { EMPTY } from "../src/file-kind.js";
import { READABLE } from "../src/index.js";
import { listZip } from "../src/zip-archive.js";

/**
 * Whether a file of this name and type would be readable, before its bytes are fetched, so a mailbox of images is
 * not downloaded to be refused. Optimistic where it cannot tell: a wrong guess costs one download, a right one a
 * document that would otherwise be invisible.
 */
export function looksReadable(filename?: string, mimeType?: string): boolean {
  const kind = classify({ filename, mimeType, data: EMPTY, listZip });
  return READABLE.has(kind) || kind === "unknown";
}
