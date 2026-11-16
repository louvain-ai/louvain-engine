import { AsyncLocalStorage } from "node:async_hooks";
import { type Embedder, toPgVector } from "@louvain/embeddings";
import type { AskMode } from "@louvain/engine-core";
import { stage as timedStage } from "../observability/stage.js";
import { type Tags, telemetry } from "../observability/telemetry.js";
import type { QuestionReading } from "./question-names.js";
import { queryLoader, recentVector } from "./recent-vectors.js";

/**
 * One context per question: what a question resolves to (the readable set, the query vector, the shape, the named
 * entity) is resolved once, lazily, and shared, and what bounds it lives beside them: one deadline every model call is
 * measured against and one budget of model calls, since a chain of individually bounded calls is not bounded. Carried
 * on `AsyncLocalStorage` because it crosses every seam; absent, each consumer computes for itself and bounds each call
 * by its own timeout.
 */

/** Below this much budget a model call is not worth starting. */
export const MIN_CALL_MS = 1_000;

/** Thrown where a model call would start after the budget is spent. Not transient: retrying cannot help. */
export class DeadlineError extends Error {
  override readonly name = "DeadlineError";
  constructor(message = "ask deadline exceeded") {
    super(message);
  }
}

/** The longest known entity the question names, resolved by the caller; the context only remembers it. */
export type NamedEntity = { name: string; kinds: string[] };

/**
 * A phase a waiting caller should be told about, since a stream gone quiet is indistinguishable from a stall. A closed
 * set of phase names, never content; installed by a streaming route, because what to say while somebody waits belongs
 * to the transport.
 */
export type AskPhase = "findings" | "inference";

/** What a streaming caller may be shown ahead of the final answer. */
export type SentenceHooks = {
  /** A sentence the verifier accepted against the same evidence the final answer is checked against. */
  onSentence?: (s: { index: number; text: string; cited: string }) => void;
  /** A sentence struck: how many of its tokens were unsupported, never the tokens themselves. */
  onStrike?: (s: { index: number; unsupported: number }) => void;
};

/**
 * What one answer may spend, per mode, as far as the engine reads it: the table of modes is `search/modes.ts`
 * (`askSettings`). An application's reader extends it with its own fields.
 */
export type AskSettings = {
  /** Documents handed to the reader whole (with `LOUVAIN_READ_DOCUMENTS`). */
  documents: number;
  /** Documents added by searching the top documents' containers again. */
  neighbours: number;
  /** Characters of a document's own text handed to the reader, per document. */
  documentChars: number;
  /** Re-order the top documents with the cross-encoder, when one is configured. */
  rerank: boolean;
  /**
   * How much retrieval the question may ask for before any model reads it: `full` is every leg; `bounded` is the vector
   * legs, the narrow lexical pass and registered retrievers, nothing that multiplies queries after the first pass.
   * Read from the mode's settings, so the mode table stays the one place a mode is defined.
   */
  recall: "bounded" | "full";
  deadlineMs: number;
};

export type AskContext = {
  /** Sanitised, as every fence sees it. */
  readonly principal: string;
  readonly orgId: string;
  readonly question: string;
  /** The effective as-of for retrieval: the question's own date when it named one. */
  readonly asOf: string | undefined;
  readonly startedAt: number;
  readonly deadline: number;
  /** How much this answer may spend — see `search/modes.ts`. */
  readonly mode: AskMode;
  readonly settings: AskSettings;
  /** Milliseconds of budget left; zero once spent, and zero once the asker has gone. */
  remaining(): number;
  /** This question's per-reader-call ceiling, from its own deadline. */
  readerCallMs(): number;
  /**
   * Aborted when the person asking has gone — a stream whose client closed.
   * Every model call's own signal is combined with it (`callSignal`), and the
   * budget reads as spent the moment it fires, so nothing further is started
   * or billed for an answer nobody will read.
   */
  readonly signal: AbortSignal | undefined;
  /** Model calls made, against the question's budget. */
  readonly calls: { used: number; max: number };
  /**
   * Take one model call from the budget. False when the calls are spent or
   * the deadline is too close to start one — the caller then skips the call,
   * and a skipped call is counted so an operator can see the budget biting.
   */
  admitCall(purpose: string): boolean;
  /** The asker's readable set, resolved once. */
  containers(): Promise<string[]>;
  /** A query's pgvector literal, embedded once per distinct text. */
  vector(text: string): Promise<string>;
  /** The language service's reading of the question, asked once. */
  shape(): Promise<QuestionReading | null>;
  /** The phrases the question names as specific things, decided once; null when the capital-letter pattern decides. */
  subjects(): Promise<string[] | null>;
  /** The entity the question names, resolved once. */
  entity(): Promise<NamedEntity | undefined>;
  /** Search queries the reader has already run for this question, normalised. */
  readonly searched: Set<string>;
  /** Seconds per stage, accumulated by `stage()`, for the caller to record with the answer. */
  readonly timings: Record<string, number>;
  readonly hooks: SentenceHooks;
};

const storage = new AsyncLocalStorage<AskContext>();
/** Cancellation alone, for a caller that has no answer budget of its own. */
const abortScope = new AsyncLocalStorage<AbortSignal>();

/**
 * The `ask.embed` stage, which never reports an error. A failed embedding is a designed degradation: every leg
 * catches it, counts `kg.read.embed.unavailable` and answers from its other leg. So the stage settles normally,
 * tagged `up: "no"`, and hands the caller the rejection itself. Timed either way, so a sidecar slow to fail shows
 * as slow.
 */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
function timedEmbed(load: (text: string) => Promise<string>, text: string): Promise<string> {
  const tags: Tags = { up: "yes" };
  return stage(
    "ask.embed",
    async (): Promise<Settled<string>> => {
      try {
        return { ok: true, value: await load(text) };
      } catch (error) {
        // swallowed: the `.then` below hands the rejection back and every leg counts it; settling here only
        // records the stage's time and its `up: "no"` tag instead of an error.
        tags.up = "no";
        return { ok: false, error };
      }
    },
    tags,
  ).then((settled) => (settled.ok ? settled.value : Promise.reject(settled.error)));
}

/**
 * One embedding per distinct text, whoever holds the map. The context's `vector()` and the standalone memo below
 * share this rule, so they cannot drift. A failed embedding is not cached: the next caller may reach a recovered
 * sidecar, and a memoised rejection would fail every leg. The embedding is the `ask.embed` stage; a memo hit is not
 * timed as one.
 */
export function memoisedVector(
  vectors: Map<string, Promise<string>>,
  load: (text: string) => Promise<string>,
  text: string,
): Promise<string> {
  const key = text.trim();
  let p = vectors.get(key);
  if (!p) {
    p = timedEmbed(load, text);
    vectors.set(key, p);
    p.catch(() => vectors.delete(key));
  }
  return p;
}

/**
 * A query-vector memo without a question context: a map of text to vector and its loader, for exactly the call it
 * wraps, so two legs of one search embed the same words once. It installs no deadline, budget or readable set; the
 * fence is still resolved per read.
 */
type VectorMemo = {
  vectors: Map<string, Promise<string>>;
  load: (text: string) => Promise<string>;
};
const vectorMemo = new AsyncLocalStorage<VectorMemo>();

/**
 * Run `fn` with one query-vector memo: every `queryVectorFor` inside it embeds a distinct text once.
 * Inside an `AskContext` the context's own memo still wins (`queryVectorFor`). `load` is the query lane the memo embeds
 * with (`queryLoader(embedder)`, or a test's).
 */
export function withQueryVectorMemo<T>(
  fn: () => Promise<T>,
  load: (text: string) => Promise<string>,
): Promise<T> {
  return vectorMemo.run({ vectors: new Map(), load }, fn);
}

export function withAskAbort<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return signal ? abortScope.run(signal, fn) : fn();
}

/** Run `fn` with `ctx` as the current question's context. */
export function withAskContext<T>(ctx: AskContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The current question's context, or nothing outside an answer. */
export function askContext(): AskContext | undefined {
  return storage.getStore();
}

/**
 * A query vector — memoised on the current question when there is one, else on the enclosing
 * `withQueryVectorMemo` scope when there is one, else shared within `orgId` for a minute (`recent-vectors.ts`).
 */
export function queryVectorFor(embedder: Embedder, text: string, orgId?: string): Promise<string> {
  const ctx = askContext();
  if (ctx) return ctx.vector(text);
  const memo = vectorMemo.getStore();
  if (memo) return memoisedVector(memo.vectors, memo.load, text);
  const load = queryLoader(embedder);
  return recentVector({ loader: load, orgId, text: text.trim() }, () => timedEmbed(load, text));
}

/**
 * A query vector from another loader (a second vector space a build keeps), memoised on `queryVectorFor`'s scope per
 * loader, so a question's vectors from two models never stand in for each other; beneath it, shared within `orgId`
 * (`recent-vectors.ts`).
 */
const otherVectors = new WeakMap<object, Map<Loader, Map<string, Promise<string>>>>();
type Loader = (text: string) => Promise<number[]>;
export function queryVectorWith(text: string, load: Loader, orgId?: string): Promise<string> {
  const embed = () =>
    recentVector({ loader: load, orgId, text }, () => load(text).then(toPgVector));
  const scope: object | undefined = storage.getStore() ?? vectorMemo.getStore();
  if (!scope) return embed();
  const loaders = otherVectors.get(scope) ?? new Map<Loader, Map<string, Promise<string>>>();
  otherVectors.set(scope, loaders);
  const memo = loaders.get(load) ?? new Map<string, Promise<string>>();
  loaders.set(load, memo);
  let hit = memo.get(text);
  if (!hit) {
    hit = embed();
    memo.set(text, hit);
    hit.catch(() => {
      // swallowed: the caller awaits this promise and handles the failure; forgotten so the next leg asks again.
      memo.delete(text);
    });
  }
  return hit;
}

/**
 * The timeout for one model call: the caller's own ceiling, cut to whatever
 * the question has left. Outside a context the ceiling stands alone.
 */
export function callTimeoutMs(ceilingMs: number): number {
  const ctx = askContext();
  if (!ctx) return ceilingMs;
  return Math.max(1, Math.min(ceilingMs, ctx.remaining()));
}

/**
 * The signal for one model call: its timeout (`callTimeoutMs`), and — inside a
 * question whose asker can leave — the question's own abort. A call in flight
 * when the client disconnects is cancelled there and then, not left to run to
 * its timeout and bill for tokens nobody receives.
 */
export function callSignal(ceilingMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(callTimeoutMs(ceilingMs));
  const asker = storage.getStore()?.signal ?? abortScope.getStore();
  return asker ? AbortSignal.any([timeout, asker]) : timeout;
}

/**
 * A stage of the answer, timed under its own name and recorded on the question's context; outside one, only timed.
 * `tags` are read when the stage settles, so a lane may note how it went on the object it passed, and a lane whose
 * failure is a designed degradation settles normally under its tag: `stage` reports only a throw the caller does not
 * survive.
 */
export function stage<T>(name: string, fn: () => Promise<T>, tags: Tags = {}): Promise<T> {
  const ctx = storage.getStore();
  const key = name.replace(/^ask\./, "");
  return timedStage(name, fn, {
    tags,
    done: (ms) => {
      if (ctx) ctx.timings[key] = Math.round(((ctx.timings[key] ?? 0) + ms / 1000) * 1000) / 1000;
    },
  });
}

/**
 * A model call whose spent budget is the lane's designed degradation, for `stage`'s `fn`. A `DeadlineError` comes
 * back as a value inside the stage, which settles under `deadline: "spent"` and reports no error: a spent budget is
 * counted (`ask.deadline`), and an error per lane per refusal would bury the reader failures worth reporting. Any
 * other throw passes through to `stage`.
 */
export function spendable<T>(fn: () => Promise<T>, tags: Tags): () => Promise<T | DeadlineError> {
  return async () => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof DeadlineError)) throw err;
      tags.deadline = "spent";
      return err;
    }
  };
}

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
