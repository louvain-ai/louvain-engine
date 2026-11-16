import { AsyncLocalStorage } from "node:async_hooks";
import { telemetry } from "../observability/telemetry.js";
import type { AskContext } from "./ask-context.js";

const storage = new AsyncLocalStorage<AskContext>();

/** Run `fn` with `ctx` as the current question's context. */
export function withAskContext<T>(ctx: AskContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The current question's context, or nothing outside an answer. */
export function askContext(): AskContext | undefined {
  return storage.getStore();
}

/**
 * A phase a waiting caller should be told about, since a stream gone quiet is indistinguishable from a stall. A closed
 * set of phase names, never content; installed by a streaming route, because what to say while somebody waits belongs
 * to the transport.
 */
export type AskPhase = "findings" | "inference";

/**
 * Where a streaming caller listens for the answer's own phases: its own storage, because a route installs it before
 * the answer's context exists. `sent` keeps the wire quiet, so a person is told of a phase once.
 */
const progress = new AsyncLocalStorage<{
  onPhase: (phase: AskPhase) => void;
  sent: Set<AskPhase>;
}>();

/** Run `fn` with a caller listening for the phases the answer passes through. */
export function withAskProgress<T>(
  onPhase: (phase: AskPhase) => void,
  fn: () => Promise<T>,
): Promise<T> {
  return progress.run({ onPhase, sent: new Set() }, fn);
}

/**
 * Announce a phase to whoever is waiting — once per answer, and nothing at all
 * when nobody is. A sink that throws is a broken transport, never a failed
 * answer: the phase is a courtesy, and the answer behind it is what matters.
 */
export function reportPhase(phase: AskPhase): void {
  const listener = progress.getStore();
  if (!listener || listener.sent.has(phase)) return;
  listener.sent.add(phase);
  try {
    listener.onPhase(phase);
  } catch (err) {
    telemetry.error("ask.progress", err);
  }
}
