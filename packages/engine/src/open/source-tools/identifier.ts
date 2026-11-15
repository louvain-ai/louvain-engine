/**
 * What an identifier is compared as, and the rules that say a source is it. Pure: no database, no model.
 *
 * An agent hands `louvain_lookup_source` the identifier exactly as a document wrote it. Each rule below compares it
 * with ONE value the engine stores about a source, exactly; the first rule that holds is the source's `matchedOn`, and
 * a source no rule holds for is not the record, however close. The fenced statements that find the candidates
 * (`lookup-reads.ts`) ask the same questions of the same values, in SQL. Whether a title OPENS with a key is the
 * build's to say (`exact-seam.ts` `titleKey`): the read marks the sources it holds for (`Stored.titleKey`).
 */

export type MatchedOn = "id" | "externalId" | "url" | "title" | "titleKey" | "fileName";

/** What a stored source offers the rules. */
export type Stored = {
  id: string;
  title: string;
  url: string | null;
  nativeId: string;
  /** Its title opens with the identifier as a key, as the build's exact tier says (`exact-seam.ts`). */
  titleKey?: boolean;
};

export type Identifier = {
  /** As written, less surrounding space and a leading `./`. */
  text: string;
  /** A document id this server hands out, given bare or inside a link to its page. */
  documentId: string | null;
  /** A URL's spellings with and without a trailing slash; none when it is not a URL. */
  urls: string[];
  /** A file name's name without its extension (`plan` for a path ending `plan.md`); null when it has none. */
  stem: string | null;
  /** A ticket, issue or pull request key: one token holding a digit and a `-` or `#` (ENG-4902, web#14). */
  keyShaped: boolean;
};

const DOCUMENT_ID = /^[a-f0-9]{64}$/;
const DOCUMENT_LINK = /\/app\/doc\/([a-f0-9]{64})(?:[/?#]|$)/;
const URL_SHAPE = /^https?:\/\/\S+$/i;

export function identifierOf(written: string): Identifier {
  const text = written.trim().replace(/^\.\//, "");
  const isUrl = URL_SHAPE.test(text);
  return {
    text,
    documentId: DOCUMENT_ID.test(text) ? text : (text.match(DOCUMENT_LINK)?.[1] ?? null),
    urls: isUrl ? urlSpellings(text) : [],
    stem: isUrl ? null : stemOf(text),
    keyShaped: isKeyShaped(text),
  };
}

function urlSpellings(url: string): string[] {
  const bare = url.replace(/\/+$/, "");
  return [...new Set([url, bare, `${bare}/`])];
}

function stemOf(path: string): string | null {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : null;
}

/** Only a key opens a title as itself: "Retro" opening "Retro notes" is a word, "ENG-4902" opening a ticket is not. */
export function isKeyShaped(text: string): boolean {
  return /^\S+$/.test(text) && /\d/.test(text) && /[-#]/.test(text);
}
const isDocument = (s: Stored, i: Identifier) => i.documentId === s.id;
const isExternalId = (s: Stored, i: Identifier) => s.nativeId === i.text;
const isAtUrl = (s: Stored, i: Identifier) => s.url !== null && i.urls.includes(s.url);
const isWholeTitle = (s: Stored, i: Identifier) => s.title.toLowerCase() === i.text.toLowerCase();
const opensWithKey = (s: Stored) => s.titleKey === true;
/** A file named so: its title is the name's stem and its own id is the path, or ends with `/<name>`. */
const isFileNamed = (s: Stored, i: Identifier) =>
  i.stem !== null &&
  s.title.toLowerCase() === i.stem.toLowerCase() &&
  (s.nativeId === i.text || s.nativeId.endsWith(`/${i.text}`));

const RULES: [MatchedOn, (s: Stored, i: Identifier) => boolean][] = [
  ["id", isDocument],
  ["externalId", isExternalId],
  ["url", isAtUrl],
  ["title", isWholeTitle],
  ["titleKey", opensWithKey],
  ["fileName", isFileNamed],
];

/** The first rule under which this source IS the identifier; null when none holds. */
export function matchedOn(source: Stored, identifier: Identifier): MatchedOn | null {
  return RULES.find(([, holds]) => holds(source, identifier))?.[0] ?? null;
}
