import { RECORD_FIELDS_MAX, RECORD_LABEL_MAX, RECORD_VALUE_MAX } from "@louvain/engine-core";
import { z } from "zod";

/**
 * What a loaded source shows as: the presentation an item makes (`open/ingest/item-event.ts`) and nothing else, read
 * before it is stored. Untrusted presentation data, never the retrieval body or a permission grant; one that fails
 * this schema is stored as none.
 */
const OpenPresentationSchema = z.object({
  /** The app a source came from (`helpdesk`), which search narrows by. Presentation only, never an access input. */
  service: z.optional(z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/)),
  /** The name a document is known by: its title and key. */
  document: z
    .object({
      filename: z.string().max(500).optional(),
    })
    .optional(),
  /** A record's fields, shown as text; its key is one. */
  record: z
    .object({
      fields: z
        .array(
          z.object({
            label: z.string().trim().max(RECORD_LABEL_MAX),
            value: z.string().max(RECORD_VALUE_MAX),
          }),
        )
        .max(RECORD_FIELDS_MAX)
        // A field with no label is dropped, not refused: one blank label must not cost the whole presentation.
        .transform((fields) => fields.filter((field) => field.label !== "")),
    })
    .optional(),
  /** Each version is the whole record, so a newer one supersedes all of an older one. */
  whole: z.literal(true).optional(),
});

/** The open accept's presentation reader (`sources/metadata.ts` `ReadPresentation`). */
export const readOpenPresentation = (raw: unknown) => OpenPresentationSchema.safeParse(raw);
