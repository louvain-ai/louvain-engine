import type { Sql } from "postgres";
import { embeddingSpace } from "./embedder.js";
import { telemetry } from "./telemetry.js";

/**
 * Which model space each org's vectors are in. A vector compares only with vectors made the same way, so a model
 * change without a re-embed degrades retrieval silently. The producer's identity is recorded per org when passages
 * are written, a second identity marks the org mixed, and the readiness probe reports how many orgs are not in this
 * deployment's space: a count, never which ones, since the probe is not fenced.
 */

/**
 * `org|fingerprint` pairs this process has recorded, so a busy writer records once per space, not once a passage, and
 * a space that changes under a running process (the embedder redeployed) is recorded again, which marks the org mixed.
 */
const recorded = new Set<string>();

/** Forget which orgs were recorded. For tests that change the space mid-process. */
export function forgetRecordedSpaces(): void {
  recorded.clear();
}

/**
 * Note that `orgId` holds vectors made in this process's space. The first space an org is written in is kept; a
 * different one arriving later sets `mixed` rather than overwriting, because the earlier vectors are still there.
 * Never fails a write: the record is an observation about vectors already stored.
 */
export async function recordEmbeddingSpace(sql: Sql, orgId: string): Promise<void> {
  try {
    const space = await embeddingSpace();
    if (!space || recorded.has(`${orgId}|${space.fingerprint}`)) return;
    await sql`insert into embedding_space (org_id, fingerprint, detail)
      values (${orgId}::uuid, ${space.fingerprint}, ${sql.json(space.detail)})
      on conflict (org_id) do update set
        mixed = embedding_space.mixed or embedding_space.fingerprint <> excluded.fingerprint,
        changed_at = case when embedding_space.fingerprint <> excluded.fingerprint then now()
                          else embedding_space.changed_at end`;
    recorded.add(`${orgId}|${space.fingerprint}`);
  } catch (err) {
    // swallowed: the passage is written; a record that failed is retried by the next write, and counted.
    telemetry.count("embedding.space.record_failed", 1, {
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

/**
 * An org re-embedded whole: its stored vectors are in this process's space, and only that. Called by the re-embed
 * script when an org's re-embed completes.
 */
export async function adoptEmbeddingSpace(sql: Sql, orgId: string): Promise<void> {
  const space = await embeddingSpace();
  if (!space) throw new Error("embedding space unknown: the bulk embedding lane did not answer");
  await sql`insert into embedding_space (org_id, fingerprint, detail)
    values (${orgId}::uuid, ${space.fingerprint}, ${sql.json(space.detail)})
    on conflict (org_id) do update set fingerprint = excluded.fingerprint, detail = excluded.detail,
      mixed = false, changed_at = now()`;
  recorded.add(`${orgId}|${space.fingerprint}`);
}
