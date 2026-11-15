import { readFileSync, writeFileSync } from "node:fs";

/**
 * A RECORDED ANSWER, AND HOW IT IS COMPARED. Ids differ between databases (a source id is derived from the org's
 * own id), so before anything is recorded or compared every id the engine hands back becomes the key of the document
 * it names (`@finance/po-4471`), every version id its key and date (`@handbook/remote-working@2024-04-02`), and every
 * cursor `<cursor>`: a cursor is sealed with a fresh nonce, and the cases follow it rather than read it.
 *
 * Writing is a command (`GOLDEN=write`), never a side effect of a failing run. A write prints one line a case: `=`
 * unchanged, `+` new, `-` gone, `~` changed with what moved.
 */
export const writing = process.env.GOLDEN === "write";

export function normalise(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  // An id alone, or leading a line the cases build (`<id>#<seq> <legs>`, `<id> <excerpt>`).
  const named = (s: string) => {
    const [, id = "", rest = ""] = /^([^\s#]+)([\s\S]*)$/.exec(s) ?? [];
    const key = ids.get(id);
    return key ? `@${key}${rest}` : s;
  };
  const walk = (v: unknown, field?: string): unknown => {
    if (typeof v === "string") return field === "nextCursor" ? "<cursor>" : named(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(JSON.parse(JSON.stringify(value)));
}

/** The documents a result names, in the order it names them. */
const keysIn = (v: unknown): string[] =>
  [...JSON.stringify(v).matchAll(/"@([^"\s#]+)/g)].map((m) => m[1] as string);

function moved(before: unknown, after: unknown): string {
  const [was, now] = [keysIn(before), keysIn(after)];
  if (was.join() !== now.join()) return `${was.join(" ")}  →  ${now.join(" ")}`;
  return "the same documents in the same order; another field changed";
}

export function readGolden(path: URL): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeGolden(
  path: URL,
  was: Record<string, unknown>,
  now: Record<string, unknown>,
): string[] {
  writeFileSync(path, `${JSON.stringify(now, null, 2)}\n`);
  const same = (name: string) => JSON.stringify(was[name]) === JSON.stringify(now[name]);
  return [
    ...Object.keys(now).map((name) =>
      !(name in was)
        ? `+ ${name}`
        : same(name)
          ? `= ${name}`
          : `~ ${name}: ${moved(was[name], now[name])}`,
    ),
    ...Object.keys(was)
      .filter((name) => !(name in now))
      .map((name) => `- ${name}`),
  ];
}
