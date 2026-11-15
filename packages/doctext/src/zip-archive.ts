/**
 * The archive, bounded: members are judged by their declared sizes against `ZIP_LIMITS` before any is inflated, then
 * inflated as a stream of compressed slices with the output counted, so a member that produces more than it declared
 * is refused the moment it does. Every reader opens a zip through `readZip`, `zipParts` or `boundedZip`; no other
 * module calls `inflateEntry` or `checkedEntries`: a reader with its own budget gets `checkedArchive`.
 */
import { Inflate, zipSync } from "fflate";
import { centralDirectory, localData, type ZipEntry } from "./zip-directory.js";
import { DecompressionRefused, MARKUP_BYTES_PER_CHAR, mib, ZIP_LIMITS } from "./zip-limits.js";

type ZipRead = {
  files: Map<string, Uint8Array>;
  /** A member was inflated only as far as the text the caller will keep. */
  truncated: boolean;
};

/** The members `want` picks, under `ZIP_LIMITS`, each inflated only as far as `chars` of text can need. */
export function readZip(zip: Uint8Array, want: (name: string) => boolean, chars: number): ZipRead {
  const archive = checkedArchive(zip, want);
  const keep = Math.max(
    64 * 1024,
    Math.min(ZIP_LIMITS.MAX_ENTRY_BYTES, chars * MARKUP_BYTES_PER_CHAR),
  );
  const files = new Map<string, Uint8Array>();
  let truncated = false;
  for (const name of archive.names()) {
    const bytes = archive.inflate(name, keep);
    if (bytes.byteLength >= keep && (archive.declaredSize(name) ?? 0) > keep) truncated = true;
    files.set(name, bytes);
  }
  return { files, truncated };
}

/**
 * Named parts of a zip as bytes, each inflated under `ZIP_LIMITS` and cut at `keep`, for a reader that needs a part's
 * markup or media rather than its words. Throws `DecompressionRefused` for a bomb; any other throw is a damaged file.
 */
export function zipParts(
  data: Uint8Array,
  wanted: (name: string) => boolean,
  keep: number = ZIP_LIMITS.MAX_ENTRY_BYTES,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const entry of checkedEntries(data, (name) => !name.endsWith("/") && wanted(name)))
    out.set(entry.name, inflateEntry(data, entry, Math.min(keep, ZIP_LIMITS.MAX_ENTRY_BYTES)));
  return out;
}

/**
 * An Office file for a reader that opens the zip itself and would inflate every member unbounded: every member is
 * inflated here under `ZIP_LIMITS` and packed again stored, so whatever opens it next can inflate nothing more.
 * Throws `DecompressionRefused` for a bomb; any other throw is a damaged file.
 */
export function boundedZip(data: Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const entry of checkedEntries(data, (name) => !name.endsWith("/")))
    files[entry.name] = inflateEntry(data, entry, ZIP_LIMITS.MAX_ENTRY_BYTES);
  return zipSync(files, { level: 0 });
}

/**
 * The wanted members of the directory, refused before anything is inflated when their declared sizes say the
 * archive is a bomb. A name repeated in the directory resolves to its last member.
 */
function checkedEntries(data: Uint8Array, wanted: (name: string) => boolean): ZipEntry[] {
  const entries = centralDirectory(data).filter((entry) => wanted(entry.name));
  let total = 0;
  for (const entry of entries) {
    if (entry.declaredSize > ZIP_LIMITS.MAX_ENTRY_BYTES)
      throw new DecompressionRefused(
        `The file is too large when decompressed: ${entry.name} would be ${mib(entry.declaredSize)}; the limit is ${mib(ZIP_LIMITS.MAX_ENTRY_BYTES)}`,
      );
    if (
      entry.declaredSize > ZIP_LIMITS.RATIO_FLOOR_BYTES &&
      entry.declaredSize > entry.compressedSize * ZIP_LIMITS.MAX_RATIO
    )
      throw new DecompressionRefused(
        `The file is too large when decompressed: ${entry.name} expands more than ${ZIP_LIMITS.MAX_RATIO} times, which no document does`,
      );
    total += entry.declaredSize;
    if (total > ZIP_LIMITS.MAX_TOTAL_BYTES)
      throw new DecompressionRefused(
        `The file is too large when decompressed: its parts would be more than ${mib(ZIP_LIMITS.MAX_TOTAL_BYTES)}`,
      );
  }
  // Walking backwards means a shadowed member is never inflated.
  const last = new Map<string, ZipEntry>();
  for (const entry of [...entries].reverse())
    if (!last.has(entry.name)) last.set(entry.name, entry);
  return [...last.values()];
}

/** Names only — read from the directory, nothing inflated. */
export function listZip(data: Uint8Array): string[] {
  return centralDirectory(data).map((entry) => entry.name);
}

/** A zip's wanted members, judged against `ZIP_LIMITS` before any is inflated. */
type CheckedArchive = {
  /** The wanted members, in the order the directory names them (a repeated name is its last member). */
  names(): string[];
  /** The size the directory declares for a wanted member, or undefined when the archive has none. */
  declaredSize(name: string): number | undefined;
  /** A wanted member's bytes, stopped at `keep` and refused past its declaration; an empty array when there is none. */
  inflate(name: string, keep: number): Uint8Array;
};

/**
 * The bounded archive for a reader that spends its own budget member by member: the limits are judged here, and a
 * member inflates only through `inflate`, which stops at the budget the caller states and refuses a lie.
 */
export function checkedArchive(
  data: Uint8Array,
  wanted: (name: string) => boolean,
): CheckedArchive {
  const entries = new Map(checkedEntries(data, wanted).map((e) => [e.name, e]));
  return {
    names: () => [...entries.keys()],
    declaredSize: (name) => entries.get(name)?.declaredSize,
    inflate: (name, keep) => {
      const entry = entries.get(name);
      return entry ? inflateEntry(data, entry, keep) : new Uint8Array(0);
    },
  };
}

/** One member's bytes, stopped at `keep`, refused the moment it produces more than the directory declared. */
function inflateEntry(data: Uint8Array, entry: ZipEntry, keep: number): Uint8Array {
  const compressed = localData(data, entry);
  if (entry.method === 0) {
    if (compressed.byteLength > entry.declaredSize)
      throw new DecompressionRefused(
        `The file is damaged or hostile: ${entry.name} is larger than its archive declares`,
      );
    return compressed.slice(0, keep);
  }
  if (entry.method !== 8)
    throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
  return joined(inflateStream(compressed, entry, keep));
}

/** Compressed input handed to the inflater at a time: at ~1,032× one slice overshoots a lying member by ~8 MB at most. */
const INFLATE_SLICE = 8 * 1024;

/** The kept chunks of a deflated member, inflated slice by slice and counted against its declared size. */
function inflateStream(compressed: Uint8Array, entry: ZipEntry, keep: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  let kept = 0;
  let enough = false;
  const inflater = new Inflate((chunk) => {
    produced += chunk.byteLength;
    if (produced > entry.declaredSize)
      throw new DecompressionRefused(
        `The file is too large when decompressed: ${entry.name} inflates past the ${mib(entry.declaredSize)} its archive declares`,
      );
    if (kept < keep) {
      const left = keep - kept;
      // Each chunk the inflater hands over is already its own copy.
      const part = chunk.byteLength > left ? chunk.slice(0, left) : chunk;
      chunks.push(part);
      kept += part.byteLength;
    }
    if (kept >= keep) enough = true;
  });
  if (compressed.byteLength === 0) inflater.push(compressed, true);
  for (let at = 0; at < compressed.byteLength && !enough; at += INFLATE_SLICE) {
    const end = Math.min(at + INFLATE_SLICE, compressed.byteLength);
    inflater.push(compressed.subarray(at, end), end === compressed.byteLength);
  }
  return chunks;
}

function joined(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
