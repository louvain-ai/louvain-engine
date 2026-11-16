import { CORPUS, type CorpusDocument, REVISIONS } from "./corpus.js";

/**
 * The corpus as the loader takes it: one ingest event a document, then one a revision, each with a fixed id (the same
 * in every database) and a fixed date. A document is a file of a loaded folder, filed under its collection.
 */
const eventId = (n: number) => `01JG${String(n).padStart(22, "0")}`;

type Place = { connector: string; workspace: string; collection: string; nativeId: string };

export function eventOf(
  place: Place,
  doc: Pick<CorpusDocument, "date" | "text" | "title">,
  n: number,
) {
  const at = `${doc.date}T09:00:00.000Z`;
  return {
    id: eventId(n),
    idempotencyKey: `${place.nativeId}@${doc.date}`,
    source: {
      connector: place.connector,
      workspace: place.workspace,
      container: place.collection,
      nativeId: place.nativeId,
      title: doc.title,
      type: "file",
    },
    kind: "file",
    occurredAt: at,
    observedAt: at,
    actor: { sourceUserId: place.nativeId.split("/").at(-1) ?? "" },
    body: { text: doc.text, presentation: { document: {} } },
    permissions: { containerTuples: [], visibility: "container" as const },
  };
}

export const inFolder = (key: string): Place => ({
  connector: "http",
  workspace: "folder",
  collection: key.split("/")[0] ?? "",
  nativeId: key,
});

const documents = CORPUS.map((d) => ({ place: inFolder(d.key), doc: d }));
const revisions = REVISIONS.map((r) => ({
  place: inFolder(r.key),
  doc: { ...r, title: CORPUS.find((d) => d.key === r.key)?.title ?? r.key },
}));
export const EVENTS = [...documents, ...revisions].map(({ place, doc }, i) =>
  eventOf(place, doc, i + 1),
);
