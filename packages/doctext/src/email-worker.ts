/**
 * The email parse in a process of its own (`email.ts` runs it through `inWorker`, which kills it at the deadline and
 * caps its heap). Its bytes are capped before they are sent here; this only parses and reads, with the limits given.
 */
import PostalMime from "postal-mime";
import { readEmail } from "./email-read.js";
import { serveReader } from "./worker.js";

serveReader(
  ({
    bytes,
    limits,
  }: {
    bytes: Uint8Array;
    limits: { maxNestingDepth: number; maxHeadersSize: number; maxRfc822NestingDepth: number };
  }) => readEmail(PostalMime, bytes, limits),
);
