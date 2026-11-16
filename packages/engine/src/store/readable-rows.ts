import type { TransactionSql } from "postgres";

/**
 * The projection writer: replace a principal's readable collections in one org with `containers`, and remember an
 * empty answer. The fence joins `readable_container` by principal on every read, so a build writes rows for the
 * principals it reads as. `principal` is the id as the projection stores it (`sanitizeId`'s output): every reader keys
 * by that id, so a row written under a raw id is never read. A principal id is not unique across orgs, so the clear is
 * scoped to this org.
 */
export async function writeProjection(
  trx: TransactionSql,
  orgId: string,
  principal: string,
  containers: string[],
): Promise<void> {
  // Scoped to this org: the re-insert only knows the org it was called for, and every row carries its org.
  await trx`
    delete from readable_container
    where principal_id = ${principal} and org_id = ${orgId}`;
  if (containers.length > 0) {
    await trx`
      insert into readable_container (principal_id, container, org_id)
      select ${principal}, c, ${orgId} from unnest(${containers}::text[]) as c
      on conflict (org_id, principal_id, container) do nothing`;
    await trx`
      delete from readable_container_empty where org_id = ${orgId} and principal_id = ${principal}`;
  } else {
    await trx`
      insert into readable_container_empty (org_id, principal_id, checked_at)
      values (${orgId}, ${principal}, now())
      on conflict (org_id, principal_id) do update set checked_at = now()`;
  }
}
