import type { ItemPrecision } from "@louvain/engine-core";

/**
 * A revision: one accepted version of a document, as the engine's writers read it for its row (`event-row.ts`), its
 * two stamps and its source document (`sources/metadata.ts`), and nothing else. The loader makes one from an item
 * (`open/ingest/item-event.ts`); any richer event carrying these fields is one as it stands, so every accept path
 * writes through the same statements.
 */
export type Revision = {
  id: string;
  /** Source-derived: a retry or a replay of the same thing collides on it, per feed. */
  idempotencyKey: string;
  kind: string;
  /** When it happened at the source, and how much of that instant the source knows (absent: all of it). */
  occurredAt: string;
  occurredPrecision?: ItemPrecision | undefined;
  /** When it was seen. */
  observedAt: string;
  source: {
    connector: string;
    workspace: string;
    container: string;
    ref?: string | undefined;
    nativeId?: string | undefined;
    title?: string | undefined;
    type?: string | undefined;
    location?: string | undefined;
    authorName?: string | undefined;
    updatedAt?: string | undefined;
  };
  actor: {
    sourceUserId: string;
    email?: string | undefined;
    displayName?: string | undefined;
    relays?: boolean | undefined;
  };
  body: unknown;
  /** The source record it is about, which one collection holds at a time. */
  record?: { objectType: string; nativeId: string; parents?: string[] | undefined } | undefined;
  /** Read only to be found (`isFoundOnly`), or worth less model: never more. */
  extractionHint?: "salient" | "index" | undefined;
  /** Who may see its container beyond the container's own readers; the open accept writes `container`. */
  permissions: { visibility: "container" | "workspace" | "public" };
};
