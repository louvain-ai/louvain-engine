/**
 * What a reading is narrowed to, for a retriever that asks an index of its own: the workspace, the containers the asker
 * may read (already narrowed to the search's collections), the as-of, and the search's other narrowings. A
 * description, never a key: the engine checks every record a retriever returns against it again.
 */
export type ReadingScope = {
  readonly orgId: string;
  readonly containers: readonly string[];
  readonly asOf?: string;
  readonly filters: Readonly<RecordFilters>;
};

/** The search's narrowings on the record a row came from, beside its fence. */
export type RecordFilters = {
  /** The actor (`actor_id` or `actor_email`), or a `from` participant where one is bound (`names`), lower-cased. */
  sender?: string;
  /** Every listed identifier appears as the actor or as a participant in any role; refused where none is bound. */
  participants?: string[];
  /** `from` inclusive, `to` exclusive, on the record's own time. */
  window?: { from?: string; to?: string };
  /** The record's connector. */
  connectors?: string[];
  /** The app the record shows as, or its connector's type: a label and a filter, never an ACL input. */
  apps?: string[];
  /** The record's genre: `include` needs one in the list; `exclude` drops a record with one in it. */
  genre?: { include?: string[]; exclude?: string[] };
};
