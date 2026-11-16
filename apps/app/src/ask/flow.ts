import type { Reading } from "@louvain/engine-core";
import type { Answerer, AnswerRequest } from "./answerer.js";
import type { Limits } from "./contract.js";
import { bindTools, type FlowEvent, shownSoFar } from "./tools.js";

/**
 * Ask, the flow: one question answered by whichever answerer is configured, under rules no answerer can change. It
 * binds the engine's two tools for this answer (`tools.ts`); passes on only citations of a document shown, each with
 * its source; holds the answer to its lookups and its deadline; and runs one answer at a time for each asker.
 */

export type { FlowEvent };

export class Busy extends Error {}

const asking = new Map<string, symbol>();

export async function ask(
  request: Omit<AnswerRequest, "tools" | "signal"> & { asker: string; signal: AbortSignal },
  engine: { answerer: Answerer; run: Reading["tool"]; limits: Limits },
  emit: (event: FlowEvent) => void,
): Promise<void> {
  const { asker, question, history } = request;
  if (asking.has(asker)) throw new Busy();
  const mine = Symbol(asker);
  asking.set(asker, mine);
  // Stop releases the asker at once, so the next question never waits on the last one's tools to finish.
  const release = () => asking.get(asker) === mine && asking.delete(asker);
  request.signal.addEventListener("abort", release, { once: true });
  const late = AbortSignal.timeout(engine.limits.deadlineMs);
  const signal = AbortSignal.any([request.signal, late]);
  const shown = shownSoFar(emit);
  const tools = bindTools(engine, shown, emit);
  try {
    for await (const event of engine.answerer.answer({ question, history, tools, signal })) {
      signal.throwIfAborted();
      if (event.type !== "cite") {
        emit(event);
        continue;
      }
      // A citation reaches the page only when it names a document this answer was shown, and its source first.
      const source = shown.get(event.ref);
      if (!source) continue;
      shown.announce(source);
      emit(event);
    }
  } catch (err) {
    if (!late.aborted) throw err;
    emit({ type: "no-answer", why: "limit" });
    emit({ type: "done" });
  } finally {
    release();
  }
}
