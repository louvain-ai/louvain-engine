import { AsyncLocalStorage } from "node:async_hooks";
import type { AsOf } from "@louvain/engine-core";

export type Instant = { validAt: string; validAtMs: number; knownAt: string | null };

/**
 * Knowledge time, as a scope: a question asked as the system knew it on a day is answered inside `withKnownAt`, and
 * every time-bounded read takes it in `instantOf`, so no read can answer from what was recorded later. It only ever
 * narrows (a later explicit `knownAt` is taken back to the scope's) and never touches the fence. Work started inside
 * the scope inherits it, which is why background work must not be started from inside a request.
 */
const knownAtStore = new AsyncLocalStorage<string>();

export function withKnownAt<T>(knownAt: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (knownAt === undefined) return fn();
  if (Number.isNaN(Date.parse(knownAt))) throw new Error("withKnownAt: knownAt is not a time");
  const outer = knownAtStore.getStore();
  return knownAtStore.run(outer === undefined ? knownAt : earlier(outer, knownAt), fn);
}

/** The knowledge time the current request is bounded by, if any. */
export const knownAtScope = (): string | undefined => knownAtStore.getStore();

const earlier = (a: string, b: string): string => (Date.parse(a) <= Date.parse(b) ? a : b);

export function instantOf(asOf: AsOf | undefined, label = "asOf"): Instant {
  const raw = typeof asOf === "string" ? { validAt: asOf } : (asOf ?? {});
  const validAt = raw.validAt ?? new Date().toISOString();
  const validAtMs = Date.parse(validAt);
  if (Number.isNaN(validAtMs)) throw new Error(`${label}: validAt is not a time`);
  if (raw.knownAt !== undefined && Number.isNaN(Date.parse(raw.knownAt))) {
    throw new Error(`${label}: knownAt is not a time`);
  }
  const scoped = knownAtStore.getStore();
  const knownAt =
    raw.knownAt === undefined
      ? (scoped ?? null)
      : scoped === undefined
        ? raw.knownAt
        : earlier(raw.knownAt, scoped);
  return { validAt, validAtMs, knownAt };
}
