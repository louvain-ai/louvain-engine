/**
 * A file's format from its bytes: a magic number cannot lie, where a name and a declared type can. A container
 * format is told apart by the members its zip directory names, never by reading the archive.
 */
import type { DocKind } from "./classify.js";

const ZIP_MEMBERS: [string, DocKind][] = [
  ["word/document.xml", "docx"],
  ["xl/workbook.xml", "xlsx"],
  ["ppt/presentation.xml", "pptx"],
];

/**
 * The bytes' own answer, or null. Reads at most the zip's central directory
 * for a container format — never the whole archive.
 */
export function sniff(data: Uint8Array, listZip: (d: Uint8Array) => string[]): DocKind | null {
  if (data.length >= 5 && starts(data, "%PDF-")) return "pdf";
  if (data.length >= 5 && starts(data, "{\\rtf")) return "rtf";
  // An iCalendar file says so in its first line, whatever it is called (an invite arrives as `invite.ics`, `invite`,
  // or with no name at all); a byte-order mark may come first.
  if (startsIgnoringBom(data, "BEGIN:VCALENDAR")) return "calendar";
  // A WebVTT file's first line is its signature, as a calendar's is (it may arrive as `transcript`, with no extension).
  if (startsIgnoringBom(data, "WEBVTT")) return "subtitles";
  // Every OOXML, ODF and EPUB file is a zip; which one it is lives inside.
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b) return zipKind(data, listZip);
  // The OLE2 header .doc, .xls and .ppt share: none has a reader, but the family is never decoded as text.
  if (
    data.length >= 8 &&
    data[0] === 0xd0 &&
    data[1] === 0xcf &&
    data[2] === 0x11 &&
    data[3] === 0xe0
  )
    return "legacy-office";
  return binaryKind(data);
}

/** A zip's format, from the members its directory names; null when it names none known or cannot be listed. */
function zipKind(data: Uint8Array, listZip: (d: Uint8Array) => string[]): DocKind | null {
  let names: string[];
  try {
    names = listZip(data);
  } catch {
    // A zip we cannot list is not a zip we can read: fall back to the name.
    return null;
  }
  const present = new Set(names);
  for (const [member, kind] of ZIP_MEMBERS) if (present.has(member)) return kind;
  // EPUB before OpenDocument: both carry a `mimetype` member, and read as ODF a book fails as damaged.
  if (
    present.has("META-INF/container.xml") ||
    names.some((name) => name.toLowerCase().endsWith(".opf"))
  )
    return "epub";
  if (present.has("content.xml")) return "odf";
  return null;
}

/**
 * The image, archive and media headers that turn up in a mailbox, named rather than inferred: "not text" is the
 * claim, and a heuristic over byte entropy would make it about the wrong thing.
 */
function binaryKind(data: Uint8Array): DocKind | null {
  if (starts(data, "\x89PNG") || starts(data, "GIF8") || starts(data, "BM")) return "binary";
  if (data[0] === 0xff && data[1] === 0xd8) return "binary"; // JPEG
  if (data.length >= 12 && starts(data.subarray(8), "WEBP")) return "binary";
  if (starts(data, "\x1f\x8b")) return "binary"; // gzip
  if (starts(data, "Rar!") || starts(data, "7z\xbc\xaf")) return "binary";
  if (data.length >= 12 && starts(data.subarray(4), "ftyp")) return "binary"; // mp4/mov
  if (starts(data, "OggS") || starts(data, "fLaC") || starts(data, "ID3")) return "binary";
  if (starts(data, "\x00\x01\x00\x00") || starts(data, "OTTO") || starts(data, "wOFF"))
    return "binary"; // fonts
  return null;
}

function startsIgnoringBom(data: Uint8Array, prefix: string): boolean {
  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
  return starts(data.subarray(bom), prefix);
}

function starts(data: Uint8Array, prefix: string): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix.charCodeAt(i)) return false;
  return true;
}
