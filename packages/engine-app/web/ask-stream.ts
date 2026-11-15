import { call } from "./session.js";

/** One answer, streamed: its events as the server sends them, a JSON line each. */

/** A document an answer was shown. `ref` is random, minted for that answer; `n` numbers it on the page, 1, 2, 3. */
export type Source = { ref: string; n: number; id: string; title: string; passage: string };
export type AskEvent =
  | { type: "activity"; label: string }
  | {
      type: "step";
      id: number;
      kind: "search" | "read" | "limit";
      state: "running" | "done" | "failed";
      label: string;
    }
  | { type: "cite"; ref: string }
  | { type: "restart" }
  | { type: "source"; source: Omit<Source, "n"> }
  | { type: "no-answer"; why: "sources-silent" | "refused" | "limit" }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "failed"; why: "key" | "busy" | "other" };

/** This sign-in already has an answer being written (another tab, or one just stopped that the server has not let go). */
export class Busy extends Error {}

/** Streams one answer's events as they arrive; aborting `signal` stops it at the server too. */
export async function ask(
  body: { question: string; history: { question: string; answer: string }[] },
  signal: AbortSignal,
  each: (event: AskEvent) => void,
): Promise<void> {
  const res = await call("api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 409 && ((await res.json()) as { error?: string }).error === "busy")
    throw new Busy();
  if (!res.ok || !res.body) throw new Error(`api/ask: ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    const lines = (pending + part.value).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) each(JSON.parse(line) as AskEvent);
  }
}
