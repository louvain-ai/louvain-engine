import type { Viewer } from "@louvain/engine-core";
import { ITEM_FEED } from "../../ingest/item-feed.js";
import { bounded } from "../../read/bounded.js";
import type { ReadContext } from "../../read/fence.js";
import { fenced } from "../../read/fenced.js";
import { type Scope, scope } from "../../read/listing/core.js";
import { documentFence, sourceJoin } from "../../read/listing/join.js";
import type { Queryable } from "../../store/sql.js";

/**
 * Where a result lives, so an agent can list its siblings: every hit and row names the container its current version
 * is filed under (`container: { id, name }`), which `louvain_search_sources` lists whole. Read under the listing's
 * fence, so a document the reader cannot open names nothing, and a container below one the reader does not read
 * (a file or folder shared on its own) is not named at all.
 */
type ContainerRef = { id: string; name: string };

/**
 * A container as a person would name it: the part after `<connector>/<workspace>/` (a folder path, a channel, a
 * project), or, where that names nothing a person would recognise (`all`, a uuid, a person's own mailbox, a file or
 * folder shared on its own), its connector, as an answer's prose names a container (`containerLabel`). Presentation
 * only: `id` is what a listing takes.
 */
export function containerName(container: string): string {
  const [connector = container, workspace, ...rest] = container.split("/");
  const unit = rest.join("/");
  const last = rest.at(-1) ?? "";
  // A folder's own files sit under "." (`item-event.ts`, the `ingest/legacy.ts` feed), stored "_" (`sanitizeId`).
  const loaded = connector === ITEM_FEED || (connector === "http" && workspace === "folder");
  if (unit === "." || (loaded && unit === "_")) return "(top folder)";
  const opaque =
    unit === "" ||
    last === "all" ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(last) ||
    /^(?:personal|managed)-/i.test(last) ||
    /^(?:file|folder)-[0-9a-f]{8}-/i.test(last);
  return opaque ? connector : unit;
}

/** The containers of these documents, as the reader may name them; a document absent from the map names none. */
export async function containersOf(
  context: ReadContext,
  owner: Viewer,
  ids: readonly string[],
): Promise<Map<string, ContainerRef>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const s = await scope(context, { orgId: owner.orgId, principal: owner.principal });
  if (s.containers.length === 0) return new Map();
  return bounded(context, async (q) => {
    // A page names at most a few dozen ids: the set-shaped fence plans in a few ms where `any` estimates every element.
    const rows = await q<{ id: string; container: string }[]>`
      select d.id, ce.container
      ${sourceJoin(q)}
      where ${documentFence(q, s, "unnest")} and r.event_id = d.current_event_id and d.id = any(${wanted}::text[])`;
    const hidden = await belowUnread(
      q,
      s,
      rows.map((row) => row.container),
    );
    return new Map(
      rows
        .filter((row) => !hidden.has(row.container))
        .map((row) => [row.id, { id: row.container, name: containerName(row.container) }]),
    );
  });
}

/** How far up a chain of containers is walked: a collection, eight folders deep, and a file shared on its own. */
const ANCESTORS_WALKED = 12;

/**
 * Which of these containers hang, at any depth, below a container the reader does not read (`container_parent`). A
 * chain longer than `ANCESTORS_WALKED` counts as below one: unseen is not readable.
 */
async function belowUnread(q: Queryable, s: Scope, containers: string[]): Promise<Set<string>> {
  const rows = await q<{ container: string }[]>`
    with recursive up(container, parent, depth) as (
      select cp.child, cp.parent, 1 from container_parent cp
      where cp.org_id = ${s.orgId} and cp.child = any(${[...new Set(containers)]}::text[])
      union all
      select up.container, cp.parent, up.depth + 1
      from up join container_parent cp on cp.org_id = ${s.orgId} and cp.child = up.parent
      where up.depth < ${ANCESTORS_WALKED}
    )
    select distinct container from up
    where not (${fenced(q, s, { column: q`parent`, shape: "any" })}) or depth = ${ANCESTORS_WALKED}`;
  return new Set(rows.map((row) => row.container));
}

type WithId = { id: string } & Record<string, unknown>;

/** Each row with its `container`, where the reader may name it (`containersOf`). */
export function placed<T extends WithId>(rows: readonly T[], where: Map<string, ContainerRef>) {
  return rows.map((row) => {
    const container = where.get(row.id);
    return container ? { ...row, container } : row;
  });
}

/** A search or list page with every row placed: its `sources` and, on a ranked page, its `outsideWindow`. */
export async function withContainers<R extends { sources: unknown[] }>(
  context: ReadContext,
  owner: Viewer,
  page: R,
): Promise<R> {
  const outside = (page as { outsideWindow?: unknown[] }).outsideWindow ?? [];
  const rows = [...page.sources, ...outside] as WithId[];
  const where = await containersOf(
    context,
    owner,
    rows.map((r) => r.id),
  );
  return {
    ...page,
    sources: placed(page.sources as WithId[], where),
    ...(outside.length > 0 ? { outsideWindow: placed(outside as WithId[], where) } : {}),
  };
}
