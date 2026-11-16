import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import type { FileReader } from "@louvain/engine-core";
import { fileReadLimits } from "../config/standalone.js";

/**
 * The engine's bounds around every reader: a file is hostile input and a reader is code the engine did not write, so
 * neither bounds itself. The file opens only if it is a regular file, is refused past the byte cap before a byte is
 * read, the reader's call races a deadline, its text is refused past the character cap, and whatever it throws or
 * returns that is not a reading refuses that one file. A reader that never yields holds the event loop: run it apart.
 */

export type Limits = { maxBytes: number; maxChars: number; deadlineMs: number };
/** The file a caller checked, by device and inode: the open descriptor must be that file, or it is refused. */
export type FileIdentity = { dev: number; ino: number };
const DEFAULT_LIMITS: Limits = fileReadLimits;

/** A file's outcome: read by a named reader, or refused with a reason (and, once read, by which reader). */
export type FileOutcome =
  | { read: true; reader: string; text: string; mtime: Date; pages?: number }
  | { read: false; reason: string; reader?: string };

/** A regular file's bytes, at most `maxBytes`, measured on the open descriptor so what is measured is what is read. */
function readRegularFile(
  full: string,
  l: { maxBytes: number; identity?: FileIdentity | undefined },
): { bytes: Uint8Array; mtime: Date } | { refused: string } {
  const maxBytes = l.maxBytes;
  let fd: number;
  try {
    // A pipe opened for reading would wait for a writer: refuse it by name first, then by the descriptor.
    const st = lstatSync(full);
    if (st.isSymbolicLink()) return { refused: "link" };
    if (!st.isFile()) return { refused: "not a regular file" };
    if (st.size > maxBytes) return { refused: "too-large" };
    fd = openSync(
      full,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch (err) {
    // swallowed: a file that vanished or became a link between the listing and the open is refused by name.
    return { refused: (err as NodeJS.ErrnoException).code === "ELOOP" ? "link" : "unreadable" };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { refused: "not a regular file" };
    // A directory on the way swapped for a link after the caller's check opens another file: refused.
    if (l.identity && (st.dev !== l.identity.dev || st.ino !== l.identity.ino))
      return { refused: "changed while it was read" };
    if (st.size > maxBytes) return { refused: "too-large" };
    const bytes = new Uint8Array(st.size);
    let off = 0;
    while (off < bytes.length) {
      const n = readSync(fd, bytes, off, bytes.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { bytes: off === bytes.length ? bytes : bytes.subarray(0, off), mtime: st.mtime };
  } finally {
    closeSync(fd);
  }
}

class Deadline extends Error {}

/** A reader's refusal reason as one bounded line: whitespace and control characters folded to one space, 120 at most. */
function reasonOf(why: string): string {
  let out = "";
  for (const ch of why) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || (c >= 0x7f && c <= 0x9f) ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > 120 ? `${out.slice(0, 119)}…` : out;
}

/** One file through one reader, inside every bound. Never throws for the file or the reader. */
export async function readFileBounded(
  file: { path: string; name: string },
  reader: FileReader | undefined,
  limits: Partial<Limits> & { identity?: FileIdentity | undefined } = {},
): Promise<FileOutcome> {
  const l = { ...DEFAULT_LIMITS, ...limits };
  if (!reader) return { read: false, reason: "no reader for this type" };
  const opened = readRegularFile(file.path, l);
  if ("refused" in opened) return { read: false, reason: opened.refused };
  let got: unknown;
  try {
    got = await raced(() => reader.read(opened.bytes, file.name), l.deadlineMs);
  } catch (err) {
    // swallowed: a reader that throws or overruns costs this file, named by its reason; the load goes on.
    return {
      read: false,
      reader: reader.name,
      reason: err instanceof Deadline ? "reader timed out" : "reader failed",
    };
  }
  return outcomeOf(got, { reader: reader.name, maxChars: l.maxChars, mtime: opened.mtime });
}

/** The reader's call raced against its deadline: `Deadline` past it, and the timer cleared however it ends. */
async function raced(read: () => unknown, deadlineMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Deadline()), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** What a reader returned, judged: a refusal with its own bounded reason, too much text, empty, or the reading. */
function outcomeOf(
  got: unknown,
  { reader, maxChars, mtime }: { reader: string; maxChars: number; mtime: Date },
): FileOutcome {
  if (!got || typeof got !== "object") return { read: false, reader, reason: "reader failed" };
  if ("refused" in got) {
    const why = (got as { refused: unknown }).refused;
    // A reader's reason is its own text: one line, bounded, before it is counted or printed.
    return {
      read: false,
      reader,
      reason: typeof why === "string" && why.trim() ? reasonOf(why) : "refused",
    };
  }
  const text = (got as { text?: unknown }).text;
  if (typeof text !== "string") return { read: false, reader, reason: "reader failed" };
  if (text.length > maxChars) return { read: false, reader, reason: "too much text" };
  // A NUL byte cannot be stored as text.
  const clean = text.includes("\u0000") ? text.replaceAll("\u0000", "") : text;
  if (!clean.trim()) return { read: false, reader, reason: "empty" };
  const pages = (got as { pages?: unknown }).pages;
  return {
    read: true,
    reader,
    text: clean,
    mtime,
    ...(typeof pages === "number" ? { pages } : {}),
  };
}
