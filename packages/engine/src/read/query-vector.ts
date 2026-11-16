import { AsyncLocalStorage } from "node:async_hooks";
import { type Embedder, toPgVector } from "@louvain/embeddings";
import type { Tags } from "../observability/telemetry.js";
import { stage } from "./ask-deadline.js";
import { askContext } from "./question.js";
import { queryLoader, recentVector } from "./recent-vectors.js";

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
  const scope: object | undefined = askContext() ?? vectorMemo.getStore();
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
