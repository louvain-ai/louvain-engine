/**
 * WHAT `type:` MEANS IN SEARCH: one table the listing's type filter and the web's query
 * parser both read, so a chip and the rows it keeps agree. A FILE type is decided in the web icon's order
 * (a client's file icons follow the same order): a specific media type first, then
 * the last extension, then the reader's format; `page` is a wiki's own page, by connector, when nothing else decides.
 * `email` and `message` are record kinds and filter as `kind`, which the API already has.
 *
 * No zod here: the web imports it for the parser.
 */

export type FileSearchType = "pdf" | "doc" | "sheet" | "slides" | "page";
export type FileTypeRule = {
  /** Media types that decide the type on their own (lower case, no parameters). */
  mimes: readonly string[];
  /** Last extensions, lower case, read when the media type is generic or absent. */
  extensions: readonly string[];
  /** `presentation.document.format` values (the reader that read it), read last. */
  formats: readonly string[];
};
const GOOGLE = "application/vnd.google-apps.";
/** In precedence order: a media type that names one type decides before any extension or format does. */
export const FILE_TYPE_RULES: Readonly<Record<Exclude<FileSearchType, "page">, FileTypeRule>> = {
  pdf: {
    mimes: ["application/pdf", "application/x-pdf"],
    extensions: ["pdf"],
    formats: ["pdf"],
  },
  doc: {
    mimes: [
      `${GOOGLE}document`,
      `${GOOGLE}kix`,
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      "application/vnd.oasis.opendocument.text",
      "application/rtf",
      "text/rtf",
      "application/vnd.apple.pages",
    ],
    extensions: ["doc", "docx", "docm", "dot", "dotx", "odt", "ott", "rtf", "pages", "wpd", "gdoc"],
    formats: ["docx", "google-doc", "rtf"],
  },
  sheet: {
    mimes: [
      `${GOOGLE}spreadsheet`,
      `${GOOGLE}ritz`,
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.apple.numbers",
      "text/csv",
      "text/tab-separated-values",
    ],
    extensions: [
      "xls",
      "xlsx",
      "xlsm",
      "xlsb",
      "xlt",
      "xltx",
      "ods",
      "ots",
      "csv",
      "tsv",
      "numbers",
      "gsheet",
    ],
    formats: ["xlsx", "sheet"],
  },
  slides: {
    mimes: [
      `${GOOGLE}presentation`,
      `${GOOGLE}punch`,
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.apple.keynote",
    ],
    extensions: [
      "ppt",
      "pptx",
      "pptm",
      "pps",
      "ppsx",
      "pot",
      "potx",
      "odp",
      "otp",
      "key",
      "gslides",
    ],
    formats: ["pptx"],
  },
};
