/**
 * The opaque forms of an origin and a series: what leaves the API in place of provider identifiers. The org is in the
 * preimage so two tenants holding one message never carry one token, and `originColumn` is the same expression in SQL:
 * the two must agree, or a row named by one query fails to group with a row named by another.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "../kg/core/sql.js";

/** An origin key's opaque form, as a summary, an evidence row or an attestation carries it. */
export function opaqueOrigin(orgId: string, originKey: string): string {
  return createHash("sha256").update(`${orgId}:${originKey}`).digest("hex").slice(0, 32);
}

/** A series key's opaque form, per org as an origin's is. */
export function opaqueSeries(orgId: string, seriesKey: string): string {
  return opaqueOrigin(orgId, `series:${seriesKey}`);
}

/** `opaqueOrigin` in SQL over `source_document` as `alias`, with the read's handle; null where it has no key. */
export function originColumn(sql: Queryable, alias: string) {
  const d = sql(alias);
  return sql`case when ${d}.origin_key is null then null
    else left(encode(sha256(convert_to(${d}.org_id::text || ':' || ${d}.origin_key, 'UTF8')), 'hex'), 32) end`;
}
