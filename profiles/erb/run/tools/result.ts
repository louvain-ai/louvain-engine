/** Every id a result carries (`id`, `sourceId`, `recordId`, at any depth), in order: what a citation may name. */
export function idsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) idsIn(v, out);
  else if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (["id", "sourceId", "recordId"].includes(key) && typeof v === "string") {
        if (!out.includes(v)) out.push(v);
      } else idsIn(v, out);
    }
  return out;
}

/** The documents a result listed: a search's `sources`, or the one document a read opened. */
export function hitsOf(tool: string, structured: unknown): string[] {
  const r = (structured ?? {}) as Record<string, unknown>;
  const idOf = (h: Record<string, unknown>) =>
    [h.id, h.sourceId, h.recordId].find((x): x is string => typeof x === "string") ?? "";
  if (tool === "louvain_read_source") return [idOf(r)].filter(Boolean);
  if (tool === "louvain_search_sources" && Array.isArray(r.sources))
    return (r.sources as Record<string, unknown>[]).map(idOf).filter(Boolean);
  return [];
}

/** The stages a search says ran degraded; `rerank:documents` means it was ranked without the reranker. */
export function degradedOf(structured: unknown): string[] {
  const said = (structured as { degraded?: unknown } | null)?.degraded;
  return Array.isArray(said) ? said.filter((d): d is string => typeof d === "string") : [];
}
