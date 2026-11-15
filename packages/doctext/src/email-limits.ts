/** What a saved mail may hold: its bytes are capped before the library sees them, and its own limits are passed. */

/** A saved mail larger than this is an archive, not a message: every attachment rides in its bytes. */
export const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

/** Multipart levels: real mail is three or four deep (mixed → alternative → related). */
export const MAX_EMAIL_NESTING = 16;

/** All header bytes, every part together: a real message's are a few kilobytes. */
export const MAX_EMAIL_HEADERS = 256 * 1024;

/** A forward of a forward of a forward: past this a message inside is an attachment, not parsed. */
export const MAX_EMAIL_FORWARDS = 3;
