import { z } from "zod";
import type { IngestItem, ItemProblem } from "./item.js";

/**
 * An ingest source: the plugin contract every way into the engine is written against. A source names a collection
 * and yields items; it never writes, never decides what is removed, never reads a file's bytes and never chooses who
 * may call it. Those rules are the engine's, written once for every source.
 */

/** A collection's name is stored as written, so only characters every store keeps as they are. */
export const CollectionNameSchema = z
  .string()
  .max(100)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "a collection's name is letters, digits, dashes and underscores, starting with a letter or digit",
  );

export type IngestSource = {
  collection: string;
  /** What it reads, as a person knows it (a folder's path): a collection listed whole keeps to one origin. */
  origin: string;
  /** The folder its items name files under, if its request named one; the host decides whether they are read. */
  files?: string;
  /** `all`: a key it did not list is gone from the source. `some`: it removes only what it marks `removed`. */
  lists: "all" | "some";
  /** Each item is checked again by the engine, whoever wrote the source. */
  items: () => AsyncIterable<IngestItem | ItemProblem>;
  /** Asked once the items are exhausted: whether the listing was whole. */
  complete: () => boolean;
};

/**
 * A fetch the engine vetted: the only network a source is handed. Every hop is HTTPS to a public address, the socket is
 * pinned to the address that was checked, and no header but `accept` goes out. The body comes back read, under a
 * bound (`maxBytes`, 32 MB unless smaller); a refusal or a body past the bound is an answer, never a throw.
 */
export type GuardedFetch = (
  url: string,
  init: { accept: string; signal: AbortSignal; maxBytes?: number },
) => Promise<
  | { ok: true; bytes: Uint8Array; contentType: string | null }
  | { ok: false; reason: string; status?: number }
>;

/** What the engine hands a source it opens: the guarded fetch, and nothing else of the process's. */
export type SourceTools = { fetch: GuardedFetch };

/**
 * A source, as its plugin starts it (`engine.config.ts` `sources`): what a person asks it for each run (`request`,
 * whose schema the engine parses first, so a wrong request is refused before anything is read) and the listing it
 * opens for that request. A source that takes items over the server's door names the token that opens it (`door`);
 * a configuration without such a source has no door.
 */
export type Source<Request = unknown> = {
  request: z.ZodType<Request>;
  open(request: Request, tools: SourceTools): IngestSource;
  door?: { token: string };
};

/** A source with its request's type kept for `open`: `create: () => source({ request, open })`. */
export const source = <Request>(s: Source<Request>): Source => s;
