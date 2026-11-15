/**
 * The central directory of a zip, walked by hand so the inflater can be handed each member's own compressed bytes.
 * Every offset it reads is bounds-checked: a directory that points outside the file is damaged, never a read past
 * the end. Sizes are as the directory declares them; `zip-archive.ts` decides whether to believe them.
 */

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  declaredSize: number;
  localOffset: number;
};

/** Every member the central directory names, sizes as declared. Throws on a malformed archive. */
export function centralDirectory(data: Uint8Array): ZipEntry[] {
  const walk: Walk = { r: byteReader(data), data, zip64: false };
  const end = directoryEnd(walk);
  walk.zip64 = end.zip64;
  const out: ZipEntry[] = [];
  let at = end.offset;
  for (let i = 0; i < end.count; i++) {
    const { entry, next } = directoryEntry(walk, at);
    out.push(entry);
    at = next;
  }
  return out;
}

/** One member's compressed bytes, found through its local header. Throws when the header or the data is damaged. */
export function localData(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const r = byteReader(data);
  if (r.u32(entry.localOffset) !== LOCAL) throw new Error(`${entry.name}: damaged local header`);
  const start =
    entry.localOffset + 30 + r.u16(entry.localOffset + 26) + r.u16(entry.localOffset + 28);
  if (start + entry.compressedSize > data.byteLength)
    throw new Error(`${entry.name}: its data runs past the end of the file`);
  return data.subarray(start, start + entry.compressedSize);
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** A Zip64 field that overflowed 32 bits reads this, and its real value is in the extra field. */
const MAX32 = 0xffffffff;

type Bytes = ReturnType<typeof byteReader>;
type Walk = { r: Bytes; data: Uint8Array; zip64: boolean };

/** Where the directory starts and how many members it holds, from the end record (Zip64's when present). */
function directoryEnd({ r, data }: Walk): { count: number; offset: number; zip64: boolean } {
  // The end record is within the last 22 + 65,535 (comment) bytes.
  let end = -1;
  for (let at = data.byteLength - 22; at >= 0 && at >= data.byteLength - 65_557; at--) {
    if (r.u32(at) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive: no end-of-directory record");
  let count = r.u16(end + 10);
  let offset = r.u32(end + 16);
  let zip64 = false;
  if (end >= 20 && r.u32(end - 20) === ZIP64_LOCATOR) {
    const record = r.u64(end - 12);
    if (r.u32(record) === ZIP64_EOCD) {
      zip64 = true;
      count = r.u64(record + 32);
      offset = r.u64(record + 48);
    }
  }
  return { count, offset, zip64 };
}

/** The directory record at `at`, and where the next one starts. */
function directoryEntry({ r, data, zip64 }: Walk, at: number): { entry: ZipEntry; next: number } {
  if (r.u32(at) !== CENTRAL) throw new Error("the archive's directory is damaged");
  const flags = r.u16(at + 8);
  const method = r.u16(at + 10);
  const sizes = { compressedSize: r.u32(at + 20), declaredSize: r.u32(at + 24), localOffset: 0 };
  const nameLength = r.u16(at + 28);
  const extraLength = r.u16(at + 30);
  const commentLength = r.u16(at + 32);
  sizes.localOffset = r.u32(at + 42);
  const nameStart = at + 46;
  if (nameStart + nameLength + extraLength + commentLength > data.byteLength)
    throw new Error("the archive's directory points outside the file");
  const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(
    data.subarray(nameStart, nameStart + nameLength),
  );
  const { declaredSize, compressedSize, localOffset } = sizes;
  if (zip64 || declaredSize === MAX32 || compressedSize === MAX32 || localOffset === MAX32)
    zip64Sizes(r, { from: nameStart + nameLength, length: extraLength }, sizes);
  return {
    entry: { name, method, ...sizes },
    next: nameStart + nameLength + extraLength + commentLength,
  };
}

/** The sizes that overflowed 32 bits, read from the extended-information extra field in its fixed order. */
function zip64Sizes(
  r: Bytes,
  { from, length }: { from: number; length: number },
  sizes: { compressedSize: number; declaredSize: number; localOffset: number },
): void {
  let extra = from;
  const extraEnd = extra + length;
  while (extra + 4 <= extraEnd) {
    const id = r.u16(extra);
    const size = r.u16(extra + 2);
    if (id === 0x0001) {
      let field = extra + 4;
      if (sizes.declaredSize === MAX32) {
        sizes.declaredSize = r.u64(field);
        field += 8;
      }
      if (sizes.compressedSize === MAX32) {
        sizes.compressedSize = r.u64(field);
        field += 8;
      }
      if (sizes.localOffset === MAX32) sizes.localOffset = r.u64(field);
      break;
    }
    extra += 4 + size;
  }
}

/** Little-endian readers that refuse to read past the end rather than return `undefined`. */
function byteReader(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const inside = (at: number, width: number): void => {
    if (!Number.isInteger(at) || at < 0 || at + width > data.byteLength)
      throw new Error("the archive's directory points outside the file");
  };
  return {
    u16: (at: number): number => {
      inside(at, 2);
      return view.getUint16(at, true);
    },
    u32: (at: number): number => {
      inside(at, 4);
      return view.getUint32(at, true);
    },
    u64: (at: number): number => {
      inside(at, 8);
      // Anything past 2^53 is past any file this reads; it fails the bounds check that follows.
      return view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32;
    },
  };
}
