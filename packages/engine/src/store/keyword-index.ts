/**
 * The BM25 sidecar's client (`services/keyword-index/bm25.py`), used by the passage keyword
 * leg (`read/keyword/`) and the reindex loader.
 *
 * Each endpoint (`bm25Endpoint`, one per engine's keyword index) reads its
 * settings on its first CALL, never at import, and keeps them and its group
 * commit itself: a module that read `process.env` at its own import time could
 * run before the host set its settings. The `bm25*` functions are the door's,
 * one endpoint for the call sites with no engine in reach (`bm25`);
 * `resetBm25Settings` forgets it, for tests that set the environment and read
 * it back.
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

import { config } from "../config/engine.js";
import { environment } from "../config/environment.js";
import { sidecarAuthHeaders } from "../config/sidecar-auth.js";
import type { Bm25Doc } from "./keyword-document.js";

type Bm25Settings = {
  endpoint: string | undefined;
  timeoutMs: number;
};

/** An endpoint's settings, read through the one environment reader (`config/environment.ts`) on its first call. */
const readSettings = (): Bm25Settings => ({
  endpoint: environment("LOUVAIN_BM25_URL"),
  timeoutMs: environment("LOUVAIN_BM25_TIMEOUT_MS"),
});

type Bm25Hit = { id: string; score: number; snippet?: { text: string } | null };

type Bm25SearchArgs = {
  orgId: string;
  /** Already resolved to what the asking principal can read. */
  containers: string[];
  query: string;
  limit: number;
  /** Bi-temporal bound: nothing recorded after this may be returned. */
  asOf?: string;
  /** NARROWINGS, never the fence (`../read/keyword/rows.ts` re-states each in SQL): any of these apps, a time range, and those
   * that state a figure. */
  apps?: string[];
  from?: string;
  to?: string;
  /** These record entries only (Elasticsearch's `ids` query). */
  ids?: readonly string[];
  figures?: true;
  /** The words asked of the title alone, a title holding at least `need` of them (`bm25_query.py` `_title_query`). */
  titles?: { need: number };
};

/**
 * One search against the sidecar. THE FENCE IS INSIDE THE SIDECAR'S QUERY, not applied here: `orgId`, `containers`
 * and `asOf` are MUST clauses of the boolean query `bm25.py` builds, so a document that fails any of them never enters
 * the ranked set this returns. Throws on any non-2xx response or a malformed body: the caller (the passage keyword leg,
 * `read/keyword/leg.ts`) lets a failure here cost the keyword contribution (`keyword:bm25` degraded), never the
 * question, the "degrade the leg, not the answer" contract every other leg carries.
 */
async function search(s: Bm25Settings, args: Bm25SearchArgs): Promise<Bm25Hit[]> {
  const data = await post<{ hits?: unknown }>(s, "search", {
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
    ...(args.titles ? { titles: args.titles } : {}),
  });
  if (!Array.isArray(data.hits)) throw new Error("bm25 search: malformed response");
  return data.hits as Bm25Hit[];
}

/** POSTs `body` to the sidecar's `path` and reads its JSON; throws when unconfigured and on any non-2xx. */
async function post<T>(s: Bm25Settings, path: string, body: unknown): Promise<T> {
  if (!s.endpoint) throw new Error(`bm25 ${path}: LOUVAIN_BM25_URL is not configured`);
  const res = await fetch(`${s.endpoint.replace(/\/$/, "")}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sidecarAuthHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(s.timeoutMs),
  });
  if (!res.ok) throw new Error(`bm25 ${path} ${res.status}`);
  return (await res.json()) as T;
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
async function index(
  s: Bm25Settings,
  docs: Bm25Doc[],
  commit: boolean,
): Promise<{ indexed: number; committed: boolean; boot?: string }> {
  return post(s, "index", { docs, commit });
}

/** Whether index jobs share a commit (`groupCommits`): `LOUVAIN_BM25_GROUP_COMMIT=off` commits per document. */
export const bm25GroupCommitOn = (): boolean => config.bm25GroupCommit;

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
async function durably(
  on: Pick<Bm25Endpoint, "index" | "groupCommit">,
  docs: Bm25Doc[],
): Promise<void> {
  const added = await on.index(docs, false);
  const committed = await on.groupCommit();
  if (added.boot !== committed) throw new Bm25Restarted();
}

/**
 * Withdraw documents from the index: a passage the pipeline deleted (a
 * quarantined event), a workspace an operator purged. The fence re-reads
 * every hit from Postgres, so a stale entry costs a miss and never a leak —
 * but the index is meant to MIRROR `event_log`, not to remember what it once
 * held. Throws like `bm25Index`, for the same reason.
 */
async function remove(s: Bm25Settings, ids: string[]): Promise<{ deleted: number }> {
  if (ids.length === 0 && s.endpoint) return { deleted: 0 };
  return post(s, "delete", { ids });
}

/**
 * Withdraw EVERY document of one org from the index — a deleted tenant. One
 * term delete on the raw `org` field inside the sidecar, however many documents
 * the tenant had, so it is bounded where a delete by id could not be: the ids
 * are gone with the tenant's rows by the time this runs. Called from the
 * durable deletion task, which retries it; throws
 * like `bm25Delete` so the task knows to.
 */
async function removeOrg(s: Bm25Settings, orgId: string): Promise<{ deleted: boolean }> {
  return post(s, "delete_org", { org: orgId });
}

/**
 * For `/readyz`, mirroring `remoteHealth`. Unconfigured means the Postgres
 * lexical legs carry retrieval alone and is not a failure; configured and
 * unreachable is reported with the reason and left to the caller to weigh.
 */
async function health(
  s: Bm25Settings,
): Promise<{ configured: boolean; ok: boolean; reason?: string }> {
  const { endpoint } = s;
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

/**
 * One keyword-index endpoint: its settings, read from the environment on its first call, and its group commit, so two
 * engines never share a commit or a setting. An engine's is its keyword index hook's (`KeywordIndex.endpoint`, one per
 * engine in the open build); `bm25` below is the door's, for the call sites with no engine in reach.
 */
export type Bm25Endpoint = {
  settings(): Bm25Settings;
  configured(): boolean;
  search(args: Bm25SearchArgs): Promise<Bm25Hit[]>;
  index(
    docs: Bm25Doc[],
    commit?: boolean,
  ): Promise<{ indexed: number; committed: boolean; boot?: string }>;
  /** Resolves once a commit that STARTED after this call has landed, to the boot id of the process that committed. */
  groupCommit(): Promise<string | undefined>;
  indexDurably(docs: Bm25Doc[]): Promise<void>;
  withdraw(ids: string[]): Promise<{ deleted: number }>;
  withdrawOrg(orgId: string): Promise<{ deleted: boolean }>;
  health(): Promise<{ configured: boolean; ok: boolean; reason?: string }>;
};

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
 */
function groupCommits(
  commit: () => Promise<string | undefined>,
): () => Promise<string | undefined> {
  let committing: Promise<string | undefined> | null = null;
  let following: Promise<string | undefined> | null = null;
  const next = (): Promise<string | undefined> => {
    if (!committing) {
      committing = commit().finally(() => {
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
          return next();
        });
    }
    return following;
  };
  return next;
}

export function bm25Endpoint(): Bm25Endpoint {
  let read: Bm25Settings | undefined;
  const settings = (): Bm25Settings => {
    read ??= readSettings();
    return read;
  };
  const endpoint: Bm25Endpoint = {
    settings,
    configured: () => settings().endpoint !== undefined,
    search: (args) => search(settings(), args),
    index: (docs, commit = true) => index(settings(), docs, commit),
    // Commit what the writer holds: an empty add with `commit: true`, resolving to the sidecar's boot id.
    groupCommit: groupCommits(async () => (await index(settings(), [], true)).boot),
    indexDurably: (docs) => durably(endpoint, docs),
    withdraw: (ids) => remove(settings(), ids),
    withdrawOrg: (orgId) => removeOrg(settings(), orgId),
    health: () => health(settings()),
  };
  return endpoint;
}

/** The door's endpoint, made on its first call: listed by the engine-state check, for call sites with no engine. */
let door: Bm25Endpoint | undefined;
const doorEndpoint = (): Bm25Endpoint => {
  door ??= bm25Endpoint();
  return door;
};

/** The door: the process's endpoint, for the call sites with no engine in reach and a build that keeps one index. */
export const bm25: Bm25Endpoint = {
  settings: () => doorEndpoint().settings(),
  configured: () => doorEndpoint().configured(),
  search: (args) => doorEndpoint().search(args),
  index: (docs, commit) => doorEndpoint().index(docs, commit),
  groupCommit: () => doorEndpoint().groupCommit(),
  indexDurably: (docs) => doorEndpoint().indexDurably(docs),
  withdraw: (ids) => doorEndpoint().withdraw(ids),
  withdrawOrg: (orgId) => doorEndpoint().withdrawOrg(orgId),
  health: () => doorEndpoint().health(),
};

/**
 * The endpoint a read's context or a write's writes carry, their keyword index's (`KeywordIndex.endpoint`); one no
 * engine made asks the door's.
 */
export const endpointOf = (on: {
  readonly hooks?: { readonly keyword?: { readonly endpoint: Bm25Endpoint } } | undefined;
}): Bm25Endpoint => on.hooks?.keyword?.endpoint ?? bm25;

/** Forget the door's endpoint, its settings with it. For tests that set the environment and read it back. */
export function resetBm25Settings(): void {
  door = undefined;
}

export const bm25Configured = (): boolean => bm25.configured();
/** Where the sidecar answers and how long a call to it may take, for its other clients (`../read/keyword/tiers.ts`). */
export const bm25Settings = (): Bm25Settings => bm25.settings();
export const bm25DeleteOrg = (orgId: string): Promise<{ deleted: boolean }> =>
  bm25.withdrawOrg(orgId);
export const bm25Health = () => bm25.health();
