/**
 * What format a file is, from three sources that lie differently: a declared mime type is a claim (one `.md` arrives
 * as three types), a filename is a claim (anyone can rename a file), and the bytes are the one thing that cannot be
 * wrong, so a recognised magic number wins (`classify-bytes.ts`). That matters most for a PDF named `.txt`, which
 * decoded as text would be indexed as a page of mojibake.
 */
import { sniff } from "./classify-bytes.js";
/** The formats with a reader, plus the two answers that are not a format. */
export type DocKind =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odf"
  | "epub"
  | "html"
  | "rtf"
  /** An iCalendar file: its events, read by `calendar.ts`. */
  | "calendar"
  /** A saved email (`.eml`): its headers, body and attachments' names, read by `email.ts`. */
  | "eml"
  /** A transcript or subtitles (`.vtt`, `.srt`): who said what, when, read by `subtitles.ts`. */
  | "subtitles"
  | "text"
  | "legacy-office"
  /**
   * Recognised, and known to carry no text: an image, a video, an archive, a
   * font. Distinct from `unknown` on purpose — "this is a PNG" and "no idea
   * what this is" lead to different decisions, because the second is worth one
   * speculative download and the first never is.
   */
  | "binary"
  | "unknown";

/**
 * Extension → kind, for the extensions that are unambiguous. This is the
 * middle authority: better than a declared mime (which a sender chooses badly)
 * and worse than the bytes.
 */
const BY_EXTENSION: Record<string, DocKind> = {
  pdf: "pdf",
  docx: "docx",
  docm: "docx",
  dotx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  xltx: "xlsx",
  pptx: "pptx",
  pptm: "pptx",
  potx: "pptx",
  odt: "odf",
  ods: "odf",
  odp: "odf",
  fodt: "odf",
  epub: "epub",
  rtf: "rtf",
  htm: "html",
  html: "html",
  xhtml: "html",
  // Everything a person would open in an editor. Deliberately long: each
  // entry is a file whose text would otherwise be thrown away, and the cost
  // of a wrong entry is that a text file is read as a text file.
  txt: "text",
  text: "text",
  md: "text",
  markdown: "text",
  mdx: "text",
  rst: "text",
  adoc: "text",
  org: "text",
  csv: "text",
  tsv: "text",
  psv: "text",
  log: "text",
  json: "text",
  jsonl: "text",
  ndjson: "text",
  geojson: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  cfg: "text",
  conf: "text",
  properties: "text",
  env: "text",
  xml: "text",
  svg: "text",
  sql: "text",
  graphql: "text",
  proto: "text",
  tex: "text",
  bib: "text",
  vtt: "subtitles",
  srt: "subtitles",
  ics: "calendar",
  ical: "calendar",
  ifb: "calendar",
  eml: "eml",
  py: "text",
  ipynb: "text",
  js: "text",
  mjs: "text",
  cjs: "text",
  jsx: "text",
  ts: "text",
  tsx: "text",
  go: "text",
  rs: "text",
  rb: "text",
  php: "text",
  pl: "text",
  r: "text",
  java: "text",
  kt: "text",
  scala: "text",
  swift: "text",
  m: "text",
  c: "text",
  h: "text",
  cc: "text",
  cpp: "text",
  hpp: "text",
  cs: "text",
  sh: "text",
  bash: "text",
  zsh: "text",
  fish: "text",
  ps1: "text",
  bat: "text",
  vue: "text",
  svelte: "text",
  css: "text",
  scss: "text",
  less: "text",
  tf: "text",
  tfvars: "text",
  hcl: "text",
  dockerfile: "text",
  makefile: "text",
  gradle: "text",
  doc: "legacy-office",
  xls: "legacy-office",
  ppt: "legacy-office",
  pps: "legacy-office",
  // Named so that a caller can decline to download them at all: an unrecognised extension is worth one speculative
  // fetch, which for a store of photographs and video is all of it.
  zip: "binary",
  gz: "binary",
  tgz: "binary",
  bz2: "binary",
  xz: "binary",
  rar: "binary",
  "7z": "binary",
  dmg: "binary",
  iso: "binary",
  exe: "binary",
  dll: "binary",
  so: "binary",
  dylib: "binary",
  bin: "binary",
  png: "binary",
  jpg: "binary",
  jpeg: "binary",
  gif: "binary",
  bmp: "binary",
  webp: "binary",
  tif: "binary",
  tiff: "binary",
  ico: "binary",
  heic: "binary",
  psd: "binary",
  ai: "binary",
  mp3: "binary",
  wav: "binary",
  flac: "binary",
  m4a: "binary",
  ogg: "binary",
  mp4: "binary",
  mov: "binary",
  avi: "binary",
  mkv: "binary",
  webm: "binary",
  ttf: "binary",
  otf: "binary",
  woff: "binary",
  woff2: "binary",
  eot: "binary",
};

/**
 * Every extension this module recognises, with its kind. For a caller that has
 * to state the readable set up front — a file picker's `accept`, a route's
 * list of the files it takes — so the list is this table rather than a
 * second one written beside it that drifts.
 */
export function extensionKinds(): [string, DocKind][] {
  return Object.entries(BY_EXTENSION);
}

const BY_MIME: Record<string, DocKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odf",
  "application/vnd.oasis.opendocument.spreadsheet": "odf",
  "application/vnd.oasis.opendocument.presentation": "odf",
  "application/epub+zip": "epub",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/html": "html",
  "text/calendar": "calendar",
  "message/rfc822": "eml",
  "text/vtt": "subtitles",
  "application/x-subrip": "subtitles",
  "application/xhtml+xml": "html",
  "application/msword": "legacy-office",
  "application/vnd.ms-excel": "legacy-office",
  "application/vnd.ms-powerpoint": "legacy-office",
  "application/json": "text",
  "application/ld+json": "text",
  "application/xml": "text",
  "application/x-yaml": "text",
  "application/yaml": "text",
  "application/toml": "text",
  "application/x-sh": "text",
  "application/javascript": "text",
  "application/x-ndjson": "text",
  // Native documents of an online suite carry these types; their exported bytes are read instead, but a stray one
  // must not be read as text.
  "application/vnd.google-apps.document": "unknown",
  "application/vnd.google-apps.spreadsheet": "unknown",
  "application/vnd.google-apps.presentation": "unknown",
};

/** Names with no extension that are nonetheless text, by convention. */
const BY_NAME = new Set([
  "readme",
  "license",
  "licence",
  "changelog",
  "contributing",
  "authors",
  "notice",
  "dockerfile",
  "makefile",
  "procfile",
  "codeowners",
]);

/**
 * A file's kind, from its bytes, its name and its declared mime — in that
 * order of authority, with one exception: a zip that sniffs as nothing known
 * defers to the name, because `.pptx` and `.odp` and a plain `.zip` all look
 * the same for the first four bytes.
 */
export function classify(args: {
  filename?: string | undefined;
  mimeType?: string | undefined;
  data: Uint8Array;
  listZip: (d: Uint8Array) => string[];
}): DocKind {
  const name = (args.filename ?? "").trim().toLowerCase();
  const base = name.split("/").pop() ?? "";
  const extension = base.includes(".") ? (base.split(".").pop() ?? "") : "";
  const mime = (args.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  const sniffed = sniff(args.data, args.listZip);
  // The bytes win, with one carve-out: a recognised binary header still lets
  // the name speak first, because a zip is the container of four formats that
  // do have readers and the name is what tells them apart.
  if (sniffed && sniffed !== "binary") return sniffed;

  const byExtension = BY_EXTENSION[extension];
  if (byExtension) return byExtension;
  const byMime = BY_MIME[mime];
  if (byMime) return byMime;
  if (!extension && BY_NAME.has(base)) return "text";

  if (sniffed) return sniffed;
  if (mime.startsWith("text/")) return "text";
  if (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime.startsWith("font/") ||
    mime === "application/zip" ||
    mime === "application/gzip" ||
    mime === "application/x-tar" ||
    mime === "application/octet-stream"
  )
    return "binary";
  return "unknown";
}
