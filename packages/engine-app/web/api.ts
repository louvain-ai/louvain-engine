import { call } from "./session.js";
import type { Doc, Page, Status } from "./types.js";

/** The app's reads: the engine's status, a page of a search, a whole document. */

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await call(path, signal ? { signal } : {});
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const status = () => json<Status>("api/status");

export const search = (q: string, cursor: string | null, signal: AbortSignal) =>
  json<Page>(`api/search?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`, signal);

export const documentById = (id: string) =>
  json<Doc>(`api/document?${new URLSearchParams({ id })}`);
