import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileIdentity } from "../readers/bounded.js";
import { type FileReaderLane, readFileBounded } from "../readers/index.js";
import type { ContentItem } from "./item-event.js";

/**
 * An item's content: its text, or the file it names, read through the file readers inside their bounds. A file is
 * read only inside the folder the run allows, never wherever an item points: its directory's real path must lie
 * inside the folder's, so neither `..` nor a linked directory leads out; the file is opened without a link, and the
 * open descriptor must be the very file that was checked, so a directory swapped for a link after the check is refused.
 */
export type Content =
  | { text: string; reader?: string; mtime?: Date }
  | { skipped: string; reader?: string };

export async function contentOf(
  item: ContentItem,
  files: string | null,
  lane: FileReaderLane | null,
): Promise<Content> {
  if (item.text !== undefined) return item.text.trim() ? { text: item.text } : { skipped: "empty" };
  if (files === null || lane === null) return { skipped: "files are not read from this source" };
  const checked = insideFolder(files, item.file);
  if (!checked) return { skipped: "outside the allowed folder" };
  const name = basename(checked.path);
  const outcome = await readFileBounded({ path: checked.path, name }, lane.readerFor(name), {
    identity: checked.identity,
  });
  if (!outcome.read)
    return { skipped: outcome.reason, ...(outcome.reader ? { reader: outcome.reader } : {}) };
  return { text: outcome.text, reader: outcome.reader, mtime: outcome.mtime };
}

/** Where `file` is under the real folder `root`, and which file it is, or null when it leads anywhere else. */
function insideFolder(
  root: string,
  file: string,
): { path: string; identity?: FileIdentity } | null {
  const full = resolve(root, file);
  let dir: string;
  try {
    dir = realpathSync(dirname(full));
  } catch {
    // swallowed: a directory that does not exist holds no file to read.
    return null;
  }
  const rel = relative(root, dir);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  const path = join(dir, basename(full));
  try {
    const st = lstatSync(path);
    return { path, identity: { dev: st.dev, ino: st.ino } };
  } catch {
    // swallowed: a file that is not there is refused by the reader's own open, by name.
    return { path };
  }
}
