/**
 * A chat message is listed by what it says, not by where it was said. A chat has no title of its own: its connector
 * names the channel ("all-hands"), a bare time, or the raw first line with its markup (`<@U042|ana>`, `:tada:`, a link),
 * and search, the source lists, citations and an agent choosing what to open all lean on the title. So a chat message's
 * title is its opening sentence, derived here deterministically (no model, so it costs nothing and works air-gapped):
 * the first line that says something, past a line that only names the channel and a transcript's `Speaker:` prefix,
 * with mention, link, emoji and formatting markup stripped, whitespace normalised, its first sentence, cut at a word
 * boundary near `CHAT_TITLE_CHARS`. Sentences and words are the platform's own segmenter's (`Intl.Segmenter`), so a
 * language without spaces is cut by its words too; nothing here reads letter case.
 *
 * Null when nothing in the text says anything (an emoji, a link alone): the caller keeps what the source stated or
 * names the place. A build that writes a better title (a model's summary) supplies `SourceRules.chatTitle`.
 */

const CHAT_TITLE_CHARS = 80;

/** What a chat title is read from: the message's text and the place it was said, as the source names it. */
export type ChatTitleInput = { text: string; place: string | null };

export function chatTitle({ text, place }: ChatTitleInput): string | null {
  const lines = text.split("\n");
  const transcript = lines.filter((line) => speakerOf(line) !== null).length >= 2;
  const here = placeKey(place);
  for (const raw of lines) {
    const line = clean(transcript ? (speakerOf(raw) ?? raw) : raw);
    if (!says(line)) continue;
    if (here && placeKey(line) === here) continue;
    return clipAtWord(opening(line), CHAT_TITLE_CHARS);
  }
  return null;
}

/**
 * The place a chat message was said, as a title names it: the source's location without a thread suffix (`#general ›
 * thread`) or its leading `#`, else the channel the presentation names, else a stated title that is the last step of
 * its collection's path (a feed that titles each thread by its channel and files it under it). Null when none names it.
 */
export function chatPlace(
  location: string | null | undefined,
  channel: unknown,
  stated: { title: string; container: string },
): string | null {
  const named =
    (location ?? "").split(" › ")[0]?.trim() || (typeof channel === "string" ? channel.trim() : "");
  const bare = named.replace(/^#+/, "").trim();
  if (bare) return bare;
  const leaf = stated.container.split("/").at(-1) ?? "";
  const title = stated.title.replace(/^#+/, "").trim();
  return title && placeKey(title) === placeKey(leaf) ? title : null;
}

/**
 * Whether a title a chat source stated is a stand-in rather than a title: nothing, the place itself, a bare time or
 * number, or the start of the message's own first line (a connector that lists a message by its first line, markup and
 * all). A title the source wrote apart from the text (a subject line) stands.
 */
export function standsInForTitle(
  stated: string,
  read: { firstLine: string; place: string | null },
): boolean {
  const title = stated.trim();
  if (!title) return true;
  if (read.place && placeKey(title) === placeKey(read.place)) return true;
  if (/^[\d\s:.,/+TZ-]+$/.test(title) && /\d/.test(title)) return true;
  const first = read.firstLine.trim();
  return first.length > 0 && (first.startsWith(title) || title.startsWith(first));
}

/** A transcript line's words after its `Speaker: ` (one to four words, no link, no sentence punctuation), else null. */
function speakerOf(line: string): string | null {
  const m = /^([^:\n]{1,40}):\s+(\S.*)$/.exec(line.trim());
  const speaker = m?.[1]?.trim() ?? "";
  if (!m || !speaker || speaker.split(/\s+/).length > 4) return null;
  if (/https?|[.?!,;]$|^\d|[()[\]{}`"<>@#]/.test(speaker)) return null;
  return m[2] ?? null;
}

/** The line with its chat markup stripped and its whitespace normalised. */
function clean(line: string): string {
  return (
    line
      // A chat's own tokens: a person or channel with its label keeps the label, a bare id or a broadcast says nothing.
      .replace(/<[@#]([A-Z0-9]+)\|([^>]*)>/g, (_m, _id: string, label: string) => label)
      .replace(/<!subteam\^[^|>]+\|([^>]*)>/g, "$1")
      .replace(/<[@#!][^>]*>/g, " ")
      // A link with a label keeps its label; an address alone says nothing.
      .replace(/<(?:https?|mailto):[^|>]*\|([^>]*)>/g, "$1")
      .replace(/<(?:https?|mailto):[^>]*>/g, " ")
      .replace(/\[([^\]]*)\]\((?:https?|mailto):[^)]*\)/g, "$1")
      .replace(/\b(?:https?:\/\/|www\.)\S+/g, " ")
      // Emoji, written as a shortcode or as the character, and what joins or styles one.
      .replace(/:[a-z0-9_+'-]*[a-z][a-z0-9_+'-]*:/g, " ")
      .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣/gu, " ")
      // A quote marker, a list bullet and formatting marks.
      .replace(/^\s*(?:&gt;|>)+\s*/, "")
      .replace(/^\s*(?:[-*•▪◦]|\d{1,3}[.)])\s+/, "")
      .replace(/```|[*~`]/g, "")
      .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Whether a cleaned line says anything: at least two letters or digits, in any script. */
const says = (line: string): boolean => (line.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;

/** A place or line as compared: no `#`, no case, no punctuation at its ends, whitespace normalised. */
function placeKey(value: string | null): string {
  return (value ?? "")
    .replace(/^#+/, "")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The line's first sentence, with the next ones while it is too short to say what the message is about. */
function opening(line: string): string {
  const sentences = [
    ...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(line),
  ].map((s) => s.segment.trim());
  let out = "";
  for (const sentence of sentences) {
    if (!sentence) continue;
    out = out ? `${out} ${sentence}` : sentence;
    if (wordCount(out) >= OPENING_WORDS) break;
  }
  return out || line;
}

/** Fewer words than this and the first sentence is a greeting or a fragment ("Hi all!"), so the next one joins it. */
const OPENING_WORDS = 4;

const wordCount = (text: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].filter(
    (s) => s.isWordLike,
  ).length;

/** At most `max` characters, cut after a whole word and marked with an ellipsis; a single long word is cut by characters. */
function clipAtWord(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  let kept = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if ([...kept].length + [...segment].length > max - 1) break;
    kept += segment;
  }
  const trimmed = kept.replace(/[\s\p{P}]+$/u, "");
  return `${trimmed.length > 0 ? trimmed : chars.slice(0, max - 1).join("")}…`;
}
