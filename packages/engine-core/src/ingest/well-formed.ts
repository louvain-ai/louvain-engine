/**
 * Text a database cannot hold is refused where it arrives.
 *
 * A JavaScript string is UTF-16, and a lone surrogate (half of a pair, the usual result of text cut
 * in the middle of an emoji) is legal in one. It is not legal in UTF-8 or in JSON's meaning of
 * text. Postgres refuses it in `jsonb` (22P02, "invalid input syntax for type json"), which failed
 * a whole ingest batch with a 500 for one title cut mid-character. In a `text` column it is
 * replaced with U+FFFD without a word: the value stored is not the value sent. Neither is the
 * sender's intent. So a request that carries one is refused with a 400 naming where it is, and
 * the sender can repair the text rather than retry a 500 for ever.
 *
 * A NUL (U+0000) is the other character neither can hold: `text` refuses it (22021) and `jsonb`
 * cannot turn `\u0000` into text (22P05), each a 500 for one character. It is legal in JSON and in
 * a JavaScript string, so a schema's `z.string()` lets it through (a share's message reached the
 * database that way); it is refused and repaired alongside a lone surrogate.
 */
export const UNSTORABLE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a NUL is exactly what is refused
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\u0000/;
/** Whether `s` holds no lone surrogate and no NUL: text Postgres stores as sent. */
export const isWellFormedText = (s: string): boolean => !UNSTORABLE.test(s);
/** A value the walkers descend into: an array, or an object literal. A Buffer, a Date, a class
 * instance is never walked: a Buffer body walked byte by byte was seconds of a blocked event
 * loop for anyone who could post one, before any authentication. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
/** A key in a reported path is cut to this many characters, and a path to this many steps (then
 * "…"): a refusal must not echo the request back, however long its keys or deep its nesting. */
const PATH_KEY_CHARS = 64;
const PATH_STEPS = 64;
type Frame = { value: unknown; key: string | number | null; parent: Frame | null };
function pathOf(frame: Frame): (string | number)[] {
  const path: (string | number)[] = [];
  for (let f: Frame | null = frame; f && f.key !== null; f = f.parent) {
    path.push(
      typeof f.key === "string" && f.key.length > PATH_KEY_CHARS
        ? `${f.key.slice(0, PATH_KEY_CHARS)}…`
        : f.key,
    );
  }
  path.reverse();
  return path.length > PATH_STEPS ? [...path.slice(0, PATH_STEPS), "…"] : path;
}
/**
 * The FIRST place in a parsed JSON value where a string, or an object KEY, holds a lone surrogate,
 * or null. A key is written into `jsonb` as surely as a value is.
 *
 * It runs before authentication (the root hook) and on every ingest event, so it is built not to
 * be a lever: it walks ITERATIVELY with an explicit stack (a body nested five thousand levels deep
 * overflowed the recursion into a 500 on every route); it descends only into arrays and object
 * literals; it keeps a parent pointer per node and builds a path only for the one hit, with long
 * keys cut; and it stops at the first. One place is what a sender needs to act, and a list of
 * twenty full paths turned 1 MB of request into 21 MB of refusal.
 */
export function firstMalformedTextPath(value: unknown): (string | number)[] | null {
  const stack: Frame[] = [{ value, key: null, parent: null }];
  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (typeof frame.key === "string" && !isWellFormedText(frame.key)) return pathOf(frame);
    const v = frame.value;
    if (typeof v === "string") {
      if (!isWellFormedText(v)) return pathOf(frame);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        const item = v[i];
        if (typeof item === "string" || Array.isArray(item) || isPlainObject(item))
          stack.push({ value: item, key: i, parent: frame });
      }
    } else if (isPlainObject(v)) {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i] as string;
        stack.push({ value: v[key], key, parent: frame });
      }
    }
  }
  return null;
}
export const MALFORMED_TEXT_MESSAGE =
  "text holds a character that can't be stored: a NUL, or a lone UTF-16 surrogate (usually text cut in the middle of a character); send it without it";
