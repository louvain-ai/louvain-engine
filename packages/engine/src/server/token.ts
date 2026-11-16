import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * The server's token: who may call it, and the key its search cursors are signed with (an HMAC of it), so one shorter
 * than this is guessable offline from any cursor and refuses the start. The file is made the safe way (an owner-only
 * directory, written under a private name and linked into place at 0600, so two starts end with one token) and read
 * the safe way: a link, a non-regular file, another user's file or one with a second name is refused by name.
 */
export const MIN_TOKEN_CHARS = 32;

export class EngineTokenRefused extends Error {}

export function engineToken(o: {
  env: string | undefined;
  file: string;
  /** The user the files must belong to: the process's own (a test passes another to see the refusal). */
  uid?: number;
  /** How the draft is written: `writeSync` (a test passes one that fails or writes short). */
  write?: (fd: number, text: string) => number;
}): {
  token: string;
  from: string;
} {
  const env = o.env?.trim();
  if (o.env !== undefined && o.env !== "") {
    if (!env || env.length < MIN_TOKEN_CHARS) throw weak("LOUVAIN_ENGINE_TOKEN");
    return { token: env, from: "LOUVAIN_ENGINE_TOKEN" };
  }
  const dir = dirname(o.file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uid = o.uid ?? process.getuid?.();
  const d = lstatSync(dir);
  if (d.isSymbolicLink() || !d.isDirectory())
    throw new EngineTokenRefused(
      `${dir} is not a directory of its own (a link, or a file): refusing to keep a token there`,
    );
  if (uid !== undefined && d.uid !== uid)
    throw new EngineTokenRefused(
      `${dir} belongs to another user: refusing to keep a token in a directory this user does not own`,
    );
  chmodSync(dir, 0o700);
  createOnce(o.file, o.write ?? writeSync);
  return { token: readToken(o.file, uid), from: o.file };
}

const weak = (where: string): EngineTokenRefused =>
  new EngineTokenRefused(
    `${where} is shorter than ${MIN_TOKEN_CHARS} characters: the search cursors are keyed by it, so a short one can be ` +
      "guessed offline from any cursor. Use a longer random value (or remove it and let the server make one).",
  );

/**
 * Make the token file whole, or leave the one another start made. The draft is removed however this ends, and a write
 * that did not put down every byte is refused, so a failed start leaves neither a draft nor a short token behind.
 */
function createOnce(file: string, write: (fd: number, text: string) => number): void {
  const draft = join(dirname(file), `.token.${process.pid}.${randomBytes(6).toString("hex")}`);
  const fd = openSync(draft, "wx", 0o600);
  try {
    try {
      const text = `${randomBytes(32).toString("hex")}\n`;
      if (write(fd, text) !== Buffer.byteLength(text))
        throw new EngineTokenRefused(`could not write a whole token beside ${file}`);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(draft, file);
    } catch (err) {
      // swallowed: EEXIST is the normal case (a token is already there, or another start just made it); it is read next.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  } finally {
    unlinkSync(draft);
  }
}

function readToken(file: string, uid: number | undefined): string {
  const st = lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile())
    throw new EngineTokenRefused(
      `${file} is a link or not a regular file: refusing to read a token through it`,
    );
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const f = fstatSync(fd);
    if (!f.isFile()) throw new EngineTokenRefused(`${file} is not a regular file`);
    if (uid !== undefined && f.uid !== uid)
      throw new EngineTokenRefused(
        `${file} belongs to another user: refusing a token this user did not make`,
      );
    if (singleName(fd) > 1)
      throw new EngineTokenRefused(
        `${file} has another name (a hard link): refusing it, since it may be a second name for another file`,
      );
    fchmodSync(fd, 0o600);
    const token = readFileSync(fd, "utf8").trim();
    if (!token)
      throw new EngineTokenRefused(`${file} is empty: remove it and the server makes a new token`);
    if (token.length < MIN_TOKEN_CHARS) throw weak(file);
    return token;
  } finally {
    closeSync(fd);
  }
}

/**
 * How many names the open file has, once a concurrent start has let go of its draft: a start that won the race holds
 * its private draft name for the moment between linking it into place and removing it, so a second name is re-read a
 * few times (about a second in all) before it is believed.
 */
function singleName(fd: number): number {
  let links = fstatSync(fd).nlink;
  for (let i = 0; links > 1 && i < 20; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    links = fstatSync(fd).nlink;
  }
  return links;
}

/** Whether a request's Authorization header carries the token, compared in constant time over equal-length digests. */
export function authorized(header: string | undefined, token: string): boolean {
  const given = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")?.[1];
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}
