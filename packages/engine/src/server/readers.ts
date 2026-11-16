/**
 * Who reads through the server: a token per reader. The engine's own token reads as the default reader, and each
 * named reader's token is a file of its own beside it (`reader-files.ts`). A token is matched against every reader's in
 * constant time, with no early exit, so how long a match takes says nothing about which reader holds it, or whether
 * any does. Two readers holding one token would make the token say nothing, so the table refuses them.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { DEFAULT_READER } from "@louvain/engine-core";
import { namedTokens } from "./reader-files.js";
import { EngineTokenRefused } from "./token.js";

/** Which reader a token, or a request's bearer header, reads as (null for none); and the readers beside the default. */
export type Readers = {
  readonly of: (token: string) => string | null;
  readonly fromHeader: (authorization: string | undefined) => string | null;
  readonly named: readonly string[];
};

/** A reader and the token it reads with. */
type Held = { readonly principal: string; readonly token: string };

/** The readers this state directory holds: the default reader with the engine's own token, and every named one. */
export const readersOf = (state: string, ownToken: string): Readers =>
  readerTable([{ principal: DEFAULT_READER, token: ownToken }, ...namedTokens(state)]);

/** The table of `held`, each token kept as its digest and compared as one. */
export function readerTable(held: readonly Held[]): Readers {
  const rows = held.map(({ principal, token }) => ({ principal, digest: digest(token) }));
  const shared = rows.find((row, i) => rows.findIndex((r) => r.digest.equals(row.digest)) !== i);
  if (shared)
    throw new EngineTokenRefused(
      `two readers hold one token (one is "${shared.principal}"): give each reader a token of its own`,
    );
  const of = (token: string) => {
    if (token === "") return null;
    const given = digest(token);
    let found: string | null = null;
    for (const row of rows) if (timingSafeEqual(given, row.digest)) found = row.principal;
    return found;
  };
  return {
    of,
    fromHeader: (authorization) => of(BEARER.exec(authorization ?? "")?.[1] ?? ""),
    named: rows.map((r) => r.principal).filter((p) => p !== DEFAULT_READER),
  };
}

/** Whether a request's Authorization header carries `token` as a bearer, compared as a reader's token is. */
export const authorized = (authorization: string | undefined, token: string): boolean =>
  readerTable([{ principal: "holder", token }]).fromHeader(authorization) !== null;

/** A bearer header: the scheme, then one token. No token, or an empty one, is no reader's. */
const BEARER = /^Bearer\s+(\S+)\s*$/i;

const digest = (token: string): Buffer => createHash("sha256").update(token).digest();
