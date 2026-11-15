/** Why a call to an embedding sidecar failed: it timed out, answered with an HTTP error, answered malformed, or not at all. */
export type EmbeddingFailure = "timeout" | "http_4xx" | "http_5xx" | "malformed" | "unreachable";

/** A sidecar call that failed, with why as a value, so nothing reads the reason back out of the message. */
export class EmbeddingFailed extends Error {
  override readonly name = "EmbeddingFailed";
  constructor(
    message: string,
    readonly reason: EmbeddingFailure,
  ) {
    super(message);
  }
}

/** A sidecar's HTTP error: a 4xx is the request's fault, anything else the sidecar's. */
export const httpFailure = (what: string, status: number): EmbeddingFailed =>
  new EmbeddingFailed(`${what} ${status}`, status >= 400 && status < 500 ? "http_4xx" : "http_5xx");

/**
 * No vector could be made: the sidecar did not answer and nothing may fall back to the in-process model. A lane that is
 * down, not work that is wrong, so a queue retries it later rather than dead-lettering the record.
 */
export class EmbeddingUnavailable extends Error {
  override readonly name = "EmbeddingUnavailable";
  constructor(options?: { cause?: unknown }) {
    super("embedding service unavailable", options);
  }
}
