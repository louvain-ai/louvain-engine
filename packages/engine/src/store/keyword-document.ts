import { appsShownBy } from "./apps.js";

/** The keyword index's document: what an index job sends the sidecar for a record (`ingest/keyword.ts`). */
export type Bm25Doc = {
  id: string;
  org: string;
  /** One container per document — a content event has exactly one. */
  container: string;
  occurredAt: string;
  text: string;
  /**
   * The record's header (the build's `PassageRules.documentHeader`, `ingest/passage-rules.ts`: the open build's is the
   * record's title), indexed as its own field and scored with a modest boost. Built from the record's own presentation
   * and listing row only. Absent means none.
   */
  header?: string;
  /** Every app a search may name the record by (`appsOf`); absent, an app filter finds it by none. */
  apps?: string[];
  /** The record's title as its source lists it, indexed as its title; absent, the text's first line stands for it. */
  title?: string;
  /**
   * Whether the record states a figure: any digit in its text, the passage legs' `digits` rule (`read/passages/filter.ts`)
   * at the record's grain, since a record states one exactly when one of its passages does. A search for figures
   * narrows to it in the index.
   */
  figures?: boolean;
  /**
   * A document entry (`read/listing/keyword-documents.ts`): one per document, its current revision's text and header, never
   * a search hit. `modified` orders a listing, `app` is the one it shows as, a facet.
   */
  kind?: "document";
  modified?: string;
  app?: string;
};

/** A digit anywhere: what the passage legs' `digits` filter keeps (`p.text ~ '[0-9]'`). */
const STATES_A_FIGURE = /[0-9]/;

/**
 * One record's keyword document: its text, its title as the source lists it, its header where the workspace writes
 * one, and the apps it is found by. The title is indexed as the title whatever the header says, so a document named by
 * a key ("note-05") is found by it.
 */
export function keywordDoc(
  ctx: { eventId: string; orgId: string; container: string; occurredAt: string },
  record: { text: string; title: string | null; header: string | null; apps: string[] },
): Bm25Doc {
  const { text, title, header, apps } = record;
  return {
    id: ctx.eventId,
    org: ctx.orgId,
    container: ctx.container,
    occurredAt: ctx.occurredAt,
    text,
    apps,
    figures: STATES_A_FIGURE.test(text),
    ...(title ? { title } : {}),
    ...(header ? { header } : {}),
  };
}

/**
 * The apps a record is found by, as the passage legs' app filter decides it (`filters.ts` `apps`): the app it shows as
 * (`source_revision.app`), its connector's type, and every app that connector shows as — exactly the apps A for which
 * `connector ∈ connectorsOfApp(A)` or the shown app is A, so the sidecar's term set and the SQL re-check agree.
 */
export function appsOf(connector: string, shown: string | null | undefined): string[] {
  return [
    ...new Set([shown, connector, ...appsShownBy(connector)].filter((a): a is string => !!a)),
  ];
}
