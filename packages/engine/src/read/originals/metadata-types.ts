import type { JSONValue } from "postgres";
import type { Revision } from "../../ingest/revision.js";
import type { ChatTitleInput } from "./chat-title.js";

/**
 * How a source's presentation is read, which the build supplies: what a source shows is the build's to say, and a
 * presentation its reader refuses is stored as none. A zod schema's `safeParse` is one.
 */
type ReadPresentation<P extends Presented> = (
  raw: unknown,
) => { success: true; data: P } | { success: false };

/** A presentation as its reader made it: stored and returned, never read into here. */
export type Presented = { [field: string]: JSONValue | undefined };

/**
 * The keys a document is grouped by: the original it is a copy of, and the series it belongs to. A build that groups
 * documents supplies them (`SourceOrigin.keys`); without one, every document stands alone.
 */
export type SourceKeys = { originKey: string | null; seriesKey: string | null };

/** What a build's `keys` is given: the source's whole text and its presentation, raw and as its reader read it. */
export type KeysRead<P extends Presented> = { text: string; presentation: unknown; read: P | null };

/**
 * What a build knows about its own connectors' sources, asked before the generic rule: a provider id an older writer
 * kept only in the event's key (and the link it makes), a workspace whose collections share provider ids (the native id
 * is then scoped by the collection), the lead its writers put before a source's own words, and a kind by connector.
 * Without rules a source is what it states: its native id, its link, its first line, its kind by event kind.
 */
export type SourceRules = {
  recoveredId?: (event: Revision) => string | undefined;
  recoveredLink?: (event: Revision, recoveredId: string) => string | undefined;
  scopesNativeId?: (event: Revision) => boolean;
  titleText?: (event: Revision, text: string) => string;
  /**
   * A chat message's title where the build writes its own (a model's summary of the thread, say); null takes the
   * generic opening sentence (`chat-title.ts`). Given the text after `titleText` and the place the source names.
   */
  chatTitle?: (read: ChatTitleInput, event: Revision) => string | null;
  kind?: (event: Revision) => string | undefined;
};

/**
 * How a source was written (by a legacy mapper or not), how its presentation is read, how it is keyed, and what the
 * build knows of its connectors.
 */
export type SourceOrigin<P extends Presented> = {
  legacy?: boolean;
  presentation: ReadPresentation<P>;
  keys?: (event: Revision, read: KeysRead<P>) => SourceKeys;
  rules?: SourceRules;
};
