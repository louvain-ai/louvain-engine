import type { Sql } from "postgres";

/**
 * Who the engine serves, one definition for the loader and the tool server: one organisation (the `default` one the
 * schema creates, so nothing here creates one) and one fixed reader, under whose id the loader writes what may be
 * read and the server reads. The resolver sanitises the id it is handed, so both sides pass this constant.
 */
export const OPEN_PRINCIPAL = "engine-reader";

/** The engine's organisation id in this pool's database: the default organisation's. Throws when the schema has none. */
export async function openOrgId(sql: Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id::text as id from org where slug = 'default'`;
  if (!row)
    throw new Error(
      "no default organisation in this database: load the schema first (`./engine up` loads db/baseline.sql)",
    );
  return row.id;
}

/**
 * The organisation id for one served value (the tools, a search): read on its first call and kept by it, since the
 * schema creates it and nothing changes it. A refusal is not kept, so loading the schema mends the next call.
 */
export function orgIdOnce(sql: Sql): () => Promise<string> {
  let known: string | undefined;
  return async () => {
    known ??= await openOrgId(sql);
    return known;
  };
}
