import { createHmac, randomBytes } from "node:crypto";
import type { Viewer } from "@louvain/engine-core";
import { type ClientNarrow, NO_CLIENT } from "./tool-helpers.js";

/**
 * What the source tools' pages need from a build, handed to their reads in their context
 * (`ReadHooks.presentation`): the names of the connections a page's sources came through (`connectionNames`), a
 * document's page in an app (`linkTo`), the key a search cursor is sealed under (`cursorKey`), and what a `client`
 * argument narrows to (`clientNarrow`). An engine built with none presents its pages as the open build does
 * (`openPresentation`, one per engine), whose pages split matches from loosely related documents (`splitsRelevance`)
 * and whose cursors its server keys from its token (`keyCursorsFrom`).
 */
export type SourceToolPresentation = {
  connectionNames(
    orgId: string,
    principal: string,
    ids: readonly string[],
  ): Promise<Map<string, string>>;
  linkTo(
    id: string | null | undefined,
    place?: { version?: string | null | undefined; thread?: string | null | undefined },
  ): { louvainUrl?: string };
  cursorKey(): Buffer;
  clientNarrow(owner: Viewer, client: string, ranked: boolean): Promise<ClientNarrow>;
  /** Whether a page splits matches from loosely related documents unless a setting says (`search-relevance.ts`). */
  readonly splitsRelevance?: boolean;
  /** Seals this engine's cursors under a key its token makes, so a cursor it issued opens after a restart. */
  keyCursorsFrom?(token: string): void;
};

/** A document's page in the build's app (`SourceToolPresentation.linkTo`): what a row builder is handed. */
export type LinkTo = SourceToolPresentation["linkTo"];

/**
 * The cursor key a token makes: an HMAC-SHA256 of the engine's bearer token under a label of its own, so a cursor one
 * engine sealed opens on that engine after a restart and on no other, and the token itself never keys anything.
 */
const cursorKeyOf = (token: string): Buffer =>
  createHmac("sha256", token).update("louvain-engine:search-cursor").digest();

/**
 * The open build's, one per engine (`createEngine`): no connection names, no app to link to, no clients, and cursors
 * sealed under this engine's key: random until its server keys it from its token, so with no server they last as long
 * as the engine does.
 */
export function openPresentation(): SourceToolPresentation {
  let key: Buffer | undefined;
  return {
    connectionNames: async () => new Map(),
    linkTo: () => ({}),
    cursorKey: () => {
      key ??= randomBytes(32);
      return key;
    },
    clientNarrow: async () => NO_CLIENT(),
    splitsRelevance: true,
    keyCursorsFrom: (token) => {
      key = cursorKeyOf(token);
    },
  };
}

/** What a read made by no engine presents: the open build's pages, and no key to seal a cursor under. */
export const unkeyedPresentation: SourceToolPresentation = {
  connectionNames: async () => new Map(),
  linkTo: () => ({}),
  cursorKey: () => {
    throw new Error("a read made by no engine has no cursor key: build it with createEngine");
  },
  clientNarrow: async () => NO_CLIENT(),
  splitsRelevance: true,
};
