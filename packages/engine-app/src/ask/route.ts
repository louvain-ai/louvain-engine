import type { Reading } from "@louvain/engine-core";
import type { Limits } from "./contract.js";
import { ask, Busy, type FlowEvent } from "./flow.js";

/**
 * `POST /app/api/ask`: one answer from the flow, streamed as JSON lines as it is written. Whether it may start (an
 * answerer, its key, a question, nobody else's answer running for this reader) is decided before the first line, so a
 * refusal is its own status. A closed connection (Stop, a closed tab) aborts it at once; everything else that decides
 * spend is the flow's.
 */

type Exchange = { question: string; answer: string };

/** Why an answer failed, as the page can say it: the model refused the key, the model is busy, or anything else. */
type Failure = "key" | "busy" | "other";
type Line = FlowEvent | { type: "failed"; why: Failure };

/** The most a question and its history may be, as text. */
const MAX_BODY_CHARS = 64_000;

const history = (value: unknown): Exchange[] =>
  (Array.isArray(value) ? value : [])
    .filter((e): e is Exchange => typeof e?.question === "string" && typeof e?.answer === "string")
    .slice(-6);

const refusal = (status: number, body: { error: string; needs?: string; message?: string }) =>
  Response.json(body, { status });

export function askRoute(limits: Limits) {
  return async (request: Request, reading: Reading): Promise<Response> => {
    const named = reading.answerer;
    if (named === null)
      return refusal(409, {
        error: "no_answerer",
        message: "Ask has no answerer: name one in engine.config.ts, then start the engine again.",
      });
    if (!named.ready) return refusal(409, { error: "no_key", needs: named.needs });
    const answerer = named.plugin;
    const body = await asked(request);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2_000) : "";
    if (!question) return refusal(400, { error: "no_question" });
    const lines = streamOf<Line>();
    // The answer may start once its first line is written; a refusal (another answer running) comes before any.
    let begun = (): void => {};
    const first = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const asking = {
      asker: reading.reader,
      question,
      history: history(body?.history),
      signal: request.signal,
    };
    const answering = ask(asking, { answerer, run: reading.tool, limits }, (event) => {
      lines.write(event);
      begun();
    })
      .catch((err: unknown) => {
        if (err instanceof Busy) throw err;
        // A stopped answer has nobody to tell; a failed one is named on the page by its kind, never its text.
        if (!request.signal.aborted) lines.write(failure(err));
      })
      .finally(lines.close);
    try {
      await Promise.race([first, answering]);
    } catch (err) {
      if (err instanceof Busy) return refusal(409, { error: "busy" });
      throw err;
    }
    return new Response(lines.stream, { headers: { "content-type": "application/x-ndjson" } });
  };
}

/** The request's body as JSON, or null when it is not JSON or is longer than a question and its history may be. */
async function asked(request: Request): Promise<{ question?: unknown; history?: unknown } | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    return JSON.parse(text) as { question?: unknown; history?: unknown } | null;
  } catch {
    // swallowed: a body that is not JSON carries no question, and is answered as none.
    return null;
  }
}

/** A failure logged here, and said on the page by its kind: the key refused, the model busy, or anything else. */
function failure(err: unknown): Line {
  const status = (err as { status?: unknown }).status;
  console.error(
    `ask: the answer failed (${typeof status === "number" ? status : "no status"}): ${String(err)}`,
  );
  return {
    type: "failed",
    why: status === 401 || status === 403 ? "key" : status === 429 ? "busy" : "other",
  };
}

/** JSON lines written as they come; once the reader has gone, writing and closing do nothing. */
function streamOf<T>() {
  const encoder = new TextEncoder();
  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      out = controller;
    },
    cancel: () => {
      out = null;
    },
  });
  return {
    stream,
    write: (line: T) => out?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
    close: () => {
      out?.close();
      out = null;
    },
  };
}
