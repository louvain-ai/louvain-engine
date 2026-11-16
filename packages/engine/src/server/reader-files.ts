/**
 * Readers' tokens as files: each named reader's token is kept under the state directory's `readers/`, made and read
 * the way the engine's own is (`token.ts`: an owner-only directory, written whole and linked into place at 0600, read
 * without following a link). `./engine reader add <name>` makes one and `remove` deletes it; the server reads them all
 * when it starts. A file whose name is not a reader's refuses the start rather than being passed over.
 */
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ReaderNameSchema } from "@louvain/engine-core";
import { EngineTokenRefused, engineToken, heldToken } from "./token.js";

/** The directory beside the engine's own token that holds the named readers' tokens. */
const READERS = "readers";

/** Each named reader and its token's file, by name; none before the first is added. */
export function readerFiles(state: string): { name: string; file: string }[] {
  const dir = join(state, READERS);
  if (!existsSync(dir)) return [];
  // A name starting with a dot is a draft `token.ts` is writing, or the system's own: never a reader.
  const names = readdirSync(dir).filter((name) => !name.startsWith("."));
  return names.sort().map((name) => ({ name: readerName(name), file: join(dir, name) }));
}

/** Every named reader with its token, each read the safe way. */
export const namedTokens = (state: string): { principal: string; token: string }[] =>
  readerFiles(state).map(({ name, file }) => ({ principal: name, token: heldToken(file) }));

/** Makes a named reader's token and says where it is kept; a reader that has one is refused, never made again. */
export function addReader(state: string, name: string): string {
  const file = join(state, READERS, readerName(name));
  if (existsSync(file))
    throw new EngineTokenRefused(
      `${name} already has a token: remove it first (./engine reader remove ${name}) to make ${name} a new one`,
    );
  engineToken({ env: undefined, file });
  return file;
}

/** Deletes a named reader's token: false when it had none. A running server holds it until it starts again. */
export function removeReader(state: string, name: string): boolean {
  const file = join(state, READERS, readerName(name));
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** `name`, when it is a reader's name; a sentence saying why not, otherwise. */
function readerName(name: string): string {
  const named = ReaderNameSchema.safeParse(name);
  if (named.success) return name;
  throw new EngineTokenRefused(
    `"${name}" is not a reader's name: ${named.error.issues[0]?.message}`,
  );
}
