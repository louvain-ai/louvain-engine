/**
 * The BM25 sidecar's client (`apps/nlp/bm25.py`), used by the passage keyword
 * leg (`plugins/retriever-keyword`) and the reindex loader.
 *
 * Mirrors `packages/embeddings/src/remote.ts`: settings are read lazily and
 * memoised, not captured as module-level `const`s, for the same reason — a
 * module that reads `process.env` at its own import time can run before the
 * host has set its settings if a formatter sorts it above the host's settings module. Reading on first CALL instead of first IMPORT cannot be
 * undone by import order. `resetBm25Settings` exists for tests that set the
 * environment and read it back.
 *
 * Unlike the embedding client this one does not fall back to an in-process
 * implementation when unconfigured — there is no in-process BM25 index to
 * fall back to, and there does not need to be one: `bm25Configured()` gates
 * whether the keyword leg asks the sidecar at all, so a deployment without it
 * runs the Postgres lexical legs exactly as before.
 *
 * Every call carries the shared sidecar bearer (`config/sidecar-auth.ts`): this is
 * the sidecar where an unauthenticated caller does the most harm, because
 * `/search` answers for whatever org and containers it is told and `/delete`
 * removes entries. A refusal is a non-2xx like any other — `bm25 search 401`
 * degrades the leg, never the question.
 */

import { config } from "../../config/engine.js";
import { sidecarAuthHeaders } from "../../config/sidecar-auth.js";
import { appsShownBy } from "./connector-apps.js";

type Bm25Settings = {
  endpoint: string | undefined;
  timeoutMs: number;
};

let settings: Bm25Settings | null = null;

function env(): Bm25Settings {
  if (settings) return settings;
  const url = process.env.LOUVAIN_BM25_URL;
  settings = {
    // Compose writes an unset optional as an empty string
    // (`LOUVAIN_BM25_URL: ${LOUVAIN_BM25_URL:-}`), and an empty string is
    // truthy enough to survive `||` but is not a URL — treat it as absent.
    endpoint: url && url.trim() !== "" ? url : undefined,
    timeoutMs: Number(process.env.LOUVAIN_BM25_TIMEOUT_MS ?? 3_000) || 3_000,
  };
  return settings;
}

/** Forget the memo. For tests that set the environment and read it back. */
export function resetBm25Settings(): void {
  settings = null;
}

export function bm25Configured(): boolean {
  return env().endpoint !== undefined;
}

/** Where the sidecar answers and how long a call to it may take, for its other clients (`bm25-tiers.ts`). */
export const bm25Settings = (): Bm25Settings => env();

export type Bm25Hit = { id: string; score: number; snippet?: { text: string } | null };

export type Bm25SearchArgs = {
  orgId: string;
  /** Already resolved to what the asking principal can read. */
  containers: string[];
  query: string;
  limit: number;
  /** Bi-temporal bound: nothing recorded after this may be returned. */
  asOf?: string;
  /** NARROWINGS, never the fence (`bm25-rows.ts` re-states each in SQL): any of these apps, a time range, and those
   * that state a figure. */
  apps?: string[];
  from?: string;
  to?: string;
  /** These record entries only (Elasticsearch's `ids` query). */
  ids?: readonly string[];
  figures?: true;
};

/**
 * One search against the sidecar. THE FENCE IS INSIDE THE SIDECAR'S QUERY,
 * not applied here — `orgId`, `containers` and `asOf` are MUST clauses of
 * the boolean query `bm25.py` builds, so a document that fails any of them
 * never enters the ranked set this returns.
 *
 * Throws on any non-2xx response or a malformed body, like
 * `remoteEmbed`: the caller (the passage keyword leg, `plugins/retriever-keyword`)
 * lets a failure here cost the BM25 contribution (`keyword:bm25` degraded),
 * never the question — the same "degrade the leg, not the answer" contract
 * every other leg carries.
 */
export async function bm25Search(args: Bm25SearchArgs): Promise<Bm25Hit[]> {
  const { endpoint, timeoutMs } = env();
  if (!endpoint) throw new Error("bm25 search: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({
      org: args.orgId,
      containers: args.containers,
      query: args.query,
      limit: args.limit,
      ...(args.asOf ? { asOf: args.asOf } : {}),
      ...(args.apps ? { apps: args.apps } : {}),
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      ...(args.ids ? { ids: args.ids } : {}),
      ...(args.figures ? { figures: true } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 search ${res.status}`);
  const data = (await res.json()) as { hits?: unknown };
  if (!Array.isArray(data.hits)) throw new Error("bm25 search: malformed response");
  return data.hits as Bm25Hit[];
}

export type Bm25Doc = {
  id: string;
  org: string;
  /** One container per document — a content event has exactly one. */
  container: string;
  occurredAt: string;
  text: string;
  /**
   * The record's header (the build's `PassageRules.recordHeader`, `ingest/passage-rules.ts`: the open build's is the
   * record's title), indexed as its own field and scored with a modest boost. Built from the record's own presentation
   * and listing row only. Absent means none.
   */
  header?: string;
  /** Every app a search may name the record by (`appsOf`); absent, an app filter finds it by none. */
  apps?: string[];
  /** The record's title as its source lists it, indexed as its title; absent, the text's first line stands for it. */
  title?: string;
  /**
   * Whether the record states a figure: any digit in its text, the passage legs' `digits` rule (`passages-filter.ts`)
   * at the record's grain, since a record states one exactly when one of its passages does. A search for figures
   * narrows to it in the index.
   */
  figures?: boolean;
  /**
   * A DOCUMENT ENTRY (`sources/keyword-documents.ts`): one per document, its current revision's text and header, never
   * a search hit. `modified` orders a listing, `app` is the one it shows as, a facet.
   */
  kind?: "document";
  modified?: string;
  app?: string;
};

/** A digit anywhere: what the passage legs' `digits` filter keeps (`p.text ~ '[0-9]'`). */
const STATES_A_FIGURE = /[0-9]/;

/**
 * One record's keyword document: its text, its title as the source lists it, its header where the workspace writes
 * one, and the apps it is found by. The title is indexed as the title whatever the header says, so a document named by
 * a key ("note-05") is found by it.
 */
export function keywordDoc(
  ctx: { eventId: string; orgId: string; container: string; occurredAt: string },
  record: { text: string; title: string | null; header: string | null; apps: string[] },
): Bm25Doc {
  const { text, title, header, apps } = record;
  return {
    id: ctx.eventId,
    org: ctx.orgId,
    container: ctx.container,
    occurredAt: ctx.occurredAt,
    text,
    apps,
    figures: STATES_A_FIGURE.test(text),
    ...(title ? { title } : {}),
    ...(header ? { header } : {}),
  };
}

/**
 * THE APPS A RECORD IS FOUND BY, as the passage legs' app filter decides it (`filters.ts` `apps`): the app it shows as
 * (`source_revision.app`), its connector's type, and every app that connector shows as — exactly the apps A for which
 * `connector ∈ connectorsOfApp(A)` or the shown app is A, so the sidecar's term set and the SQL re-check agree.
 */
export function appsOf(connector: string, shown: string | null | undefined): string[] {
  return [
    ...new Set([shown, connector, ...appsShownBy(connector)].filter((a): a is string => !!a)),
  ];
}

/**
 * Upsert a batch into the sidecar's index. `commit` defaults to true, like
 * the sidecar's own default: a caller that wants to stream many batches
 * before paying a commit's cost passes `false` and commits on the last one.
 *
 * Throws on failure rather than swallowing it — unlike a search leg, a write
 * that silently drops documents leaves the index permanently short of what
 * Postgres has, with nothing to point at until a question the missing
 * document should have answered comes back empty.
 */
export async function bm25Index(
  docs: Bm25Doc[],
  commit = true,
): Promise<{ indexed: number; committed: boolean; boot?: string }> {
  const { endpoint, timeoutMs } = env();
  if (!endpoint) throw new Error("bm25 index: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/index`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({ docs, commit }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 index ${res.status}`);
  return (await res.json()) as { indexed: number; committed: boolean; boot?: string };
}

/**
 * ONE COMMIT FOR EVERY DOCUMENT ADDED BEFORE IT STARTED, SHARED BY WHOEVER IS WAITING.
 *
 * The sidecar keeps one writer, so a document indexed with `commit: false` waits in it until the next commit, and
 * each commit is a segment write and an fsync under the sidecar's one writer lock. Committing per document made every
 * index worker queue behind every other one's fsync. A group commit keeps the promise the index job makes — its
 * document is DURABLE in the index before the job completes and marks it, so a failure still retries the job — while
 * a burst shares one commit: the first waiter commits at once; anyone who arrives while that commit runs joins the
 * NEXT one, because the running commit may have started before their document was added. No added delay: an idle
 * process commits exactly as before.
 *
 * `LOUVAIN_BM25_GROUP_COMMIT=off` commits per document again.
 */
let committing: Promise<string | undefined> | null = null;
let following: Promise<string | undefined> | null = null;

export const bm25GroupCommitOn = (): boolean => config.bm25GroupCommit;

/** Commit what the writer holds: an empty add with `commit: true`. Resolves to the sidecar's boot id. */
async function bm25Commit(): Promise<string | undefined> {
  return (await bm25Index([], true)).boot;
}

/** Resolves once a commit that STARTED after this call has landed, to the boot id of the process that committed. */
export function bm25GroupCommit(): Promise<string | undefined> {
  if (!committing) {
    committing = bm25Commit().finally(() => {
      committing = null;
    });
    return committing;
  }
  if (!following) {
    following = committing
      .catch(() => {
        // swallowed: the running commit's failure is its own waiters'; this group commits on its own
      })
      .then(() => {
        following = null;
        return bm25GroupCommit();
      });
  }
  return following;
}

/** The sidecar restarted between an uncommitted add and the commit meant to cover it: the add is gone. */
export class Bm25Restarted extends Error {
  constructor() {
    super(
      "bm25 sidecar restarted between the add and its commit; the document must be indexed again",
    );
    this.name = "Bm25Restarted";
  }
}

/**
 * ADD UNCOMMITTED, THEN SHARE A COMMIT, AND PROVE THE SAME PROCESS DID BOTH. An uncommitted add lives in the
 * sidecar's writer and dies with its process; a commit to a NEW process succeeds, empty, and a job that marked its
 * document indexed on that would leave it out of the keyword index until a manual rebuild. So the add's boot id and
 * the commit's must match, or this throws `Bm25Restarted` and the index job retries — the re-add is an upsert. A
 * sidecar too old to say its boot id (both undefined) is trusted as before.
 */
export async function bm25IndexDurably(docs: Bm25Doc[]): Promise<void> {
  const added = await bm25Index(docs, false);
  const committed = await bm25GroupCommit();
  if (added.boot !== committed) throw new Bm25Restarted();
}

/**
 * Withdraw documents from the index: a passage the pipeline deleted (a
 * quarantined event), a workspace an operator purged. The fence re-reads
 * every hit from Postgres, so a stale entry costs a miss and never a leak —
 * but the index is meant to MIRROR `event_log`, not to remember what it once
 * held. Throws like `bm25Index`, for the same reason.
 */
export async function bm25Delete(ids: string[]): Promise<{ deleted: number }> {
  const { endpoint, timeoutMs } = env();
  if (!endpoint) throw new Error("bm25 delete: LOUVAIN_BM25_URL is not configured");
  if (ids.length === 0) return { deleted: 0 };
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 delete ${res.status}`);
  return (await res.json()) as { deleted: number };
}

/**
 * Withdraw EVERY document of one org from the index — a deleted tenant. One
 * term delete on the raw `org` field inside the sidecar, however many documents
 * the tenant had, so it is bounded where a delete by id could not be: the ids
 * are gone with the tenant's rows by the time this runs. Called from the
 * durable deletion task, which retries it; throws
 * like `bm25Delete` so the task knows to.
 */
export async function bm25DeleteOrg(orgId: string): Promise<{ deleted: boolean }> {
  const { endpoint, timeoutMs } = env();
  if (!endpoint) throw new Error("bm25 delete_org: LOUVAIN_BM25_URL is not configured");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/delete_org`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify({ org: orgId }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 delete_org ${res.status}`);
  return (await res.json()) as { deleted: boolean };
}

/**
 * For `/readyz`, mirroring `remoteHealth`. Unconfigured means the Postgres
 * lexical legs carry retrieval alone and is not a failure; configured and
 * unreachable is reported with the reason and left to the caller to weigh.
 */
export async function bm25Health(): Promise<{ configured: boolean; ok: boolean; reason?: string }> {
  const { endpoint } = env();
  if (!endpoint) return { configured: false, ok: true };
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/healthz`, {
      headers: sidecarAuthHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok
      ? { configured: true, ok: true }
      : { configured: true, ok: false, reason: `healthz ${res.status}` };
  } catch (err) {
    // swallowed: the failure IS the probe's answer — returned as `reason` to
    // /readyz, which lists the sidecar under `degraded` and never fails on it.
    return { configured: true, ok: false, reason: String(err) };
  }
}
