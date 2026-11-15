/** The argument helpers the source tools share: pure, no import, and one refusal class (`ToolInputError`). */

export const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() : fallback;

/**
 * The caller got the arguments wrong. Reported to the model inside the result
 * with `isError: true` and this message — MCP's own rule for a failed tool —
 * rather than as a successful `{ error }`, which a model reads as an answer, or
 * as a protocol error, which it never sees at all. The message is authored here
 * and carries nothing from an exception, so it is safe to show.
 */
export class ToolInputError extends Error {
  override name = "ToolInputError";
}

/** A date the caller may supply for a point-in-time read; anything unparseable is "now". */
export const asOf = (value: unknown): string | undefined => {
  const raw = str(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const clamp = (value: unknown, fallback: number, max: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
};

/**
 * Which connection a source came through: its id, and its name where the person may see it (the bound
 * presentation's `connectionNames`), so two connections to one app are told apart.
 */
export function connectionOf(
  id: string | undefined,
  names: ReadonlyMap<string, string>,
): { connectionId?: string; connectionName?: string } {
  if (!id) return {};
  const name = names.get(id);
  return { connectionId: id, ...(name ? { connectionName: name } : {}) };
}

/**
 * One client, as a listing narrows to it: the identifiers the client is placed by (verified addresses and domains,
 * never a name), and for a ranked head the records that state them (newest first, capped). A client the reader cannot
 * see, or no client by that id, narrows to nothing, the same empty answer, so the tool never tells anyone a client
 * exists. Resolved by the bound presentation (`clientNarrow`); with no clients, every client narrows to nothing.
 */
export type ClientNarrow = { ids: string[]; bounded: boolean; records: Set<string> | null };

/** A client that narrows to nothing: unknown, unreadable, or none bound. */
export const NO_CLIENT: () => ClientNarrow = () => ({
  ids: [],
  bounded: false,
  records: new Set(),
});

/** The listing's narrowing for a client, when one was asked for. */
export const clientListing = (client: ClientNarrow | undefined) =>
  client
    ? {
        narrow: {
          include: client.ids,
          exclude: [],
          added: [],
          removed: [],
          collections: [],
          folderFiles: { workspaces: [], ids: [] },
          ruledRecords: [],
          bounded: client.bounded,
        },
      }
    : {};
