import type { Viewer } from "@louvain/engine-core";
import { engineCursorKey } from "./cursor-key.js";
import { type ClientNarrow, NO_CLIENT } from "./tool-helpers.js";

/**
 * What the source tools' pages need from a build, handed to their reads in their context
 * (`ReadHooks.presentation`): the names of the connections a page's sources came through (`connectionNames`), a
 * document's page in an app (`linkTo`), the key a search cursor is sealed under (`cursorKey`), and what a `client`
 * argument narrows to (`clientNarrow`). A read handed none presents its page as `openPresentation`.
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
};

/** A document's page in the build's app (`SourceToolPresentation.linkTo`): what a row builder is handed. */
export type LinkTo = SourceToolPresentation["linkTo"];

/** The open build's: no connection names, no app to link to, cursors keyed by the engine, no clients. */
export const openPresentation: SourceToolPresentation = {
  connectionNames: async () => new Map(),
  linkTo: () => ({}),
  cursorKey: () => engineCursorKey(),
  clientNarrow: async () => NO_CLIENT(),
};
