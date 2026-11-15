import postgres, { type Sql, type TransactionSql } from "postgres";
import { jitPolicy, planCachePolicy } from "./db-settings.js";
import { telemetry } from "./telemetry.js";

/**
 * The store: the pool the engine reads and writes through, as a value its caller opens and ends. A bounded read is a
 * transaction whose statements are cut at a timeout, plan for their own parameters and never JIT-compile; each is a
 * `set local`, so it reaches the right backend through any pooler and never leaks into the next statement.
 */
export type Store = {
  readonly sql: Sql;
  /** What every bounded read through it is held to. */
  readonly bounds: ReadBounds;
  boundedRead<T>(fn: (trx: TransactionSql) => Promise<T>, settings?: readonly string[]): Promise<T>;
  end(): Promise<void>;
};

/** What every bounded read is held to: its statement timeout, and the plan cache mode, or null with prepares off. */
export type ReadBounds = { readonly readTimeoutMs: number; readonly plan: string | null };

/** The `set local` statements a bounded read opens with, in order; a caller's own last, so a shorter timeout wins. */
export const readPreamble = (bounds: ReadBounds, settings: readonly string[] = []): string =>
  [
    `set local statement_timeout = ${bounds.readTimeoutMs}`,
    "set local jit = off",
    ...(bounds.plan ? [`set local plan_cache_mode = ${bounds.plan}`] : []),
    ...settings,
  ].join("; ");

/** A store around a pool its caller opened: a host that opens its own (startup parameters, a pooler) wraps it here. */
export function storeOf(sql: Sql, bounds: ReadBounds): Store {
  let inFlight = 0;
  async function boundedRead<T>(
    fn: (trx: TransactionSql) => Promise<T>,
    settings: readonly string[] = [],
  ): Promise<T> {
    // How long a read waited for the pool, apart from how long it ran: a stage timed around it counts both.
    const asked = performance.now();
    telemetry.gauge("db.bounded_reads_in_flight", ++inFlight);
    try {
      return (await sql.begin(async (trx) => {
        telemetry.timing("db.bounded_read_wait", performance.now() - asked);
        await trx.unsafe(readPreamble(bounds, settings));
        return fn(trx);
      })) as T;
    } finally {
      telemetry.gauge("db.bounded_reads_in_flight", --inFlight);
    }
  }
  return { sql, bounds, boundedRead, end: () => sql.end({ timeout: 5 }) };
}

/** What a pool is opened with: the engine's database settings (`config/engine.ts`), and every read's timeout. */
type StoreSettings = {
  readonly prepare: boolean;
  readonly planCacheMode: Parameters<typeof planCachePolicy>[0]["mode"];
  readonly planCacheScope: Parameters<typeof planCachePolicy>[0]["scope"];
  readonly jit: Parameters<typeof jitPolicy>[0]["setting"];
  readonly poolMax: number;
  readonly readTimeoutMs: number;
};

/**
 * Open a store on a database: its pool, its prepared statements planned as the settings decide (`db-settings.ts`: a
 * `set local` in every bounded read wherever prepared statements are on, a startup parameter as well only where the
 * address cannot be a pooler), JIT off at connect where no pooler can refuse it, and the read bounds every bounded read
 * keeps. Nothing connects until the first statement; the caller ends it (`Store.end`, or the engine's `close`).
 */
export function openStore(url: string, settings: StoreSettings): Store {
  const planCache = planCachePolicy({
    prepare: settings.prepare,
    mode: settings.planCacheMode,
    scope: settings.planCacheScope,
    url,
  });
  const jit = jitPolicy({ setting: settings.jit, url });
  const startup: Record<string, string> = {
    ...(planCache.startup ? { plan_cache_mode: planCache.startup } : {}),
    ...(jit.startup ? { jit: "off" } : {}),
  };
  const sql = postgres(url, {
    onnotice: () => {},
    prepare: settings.prepare,
    ...(Object.keys(startup).length > 0 ? { connection: startup } : {}),
    // A small pool becomes the ceiling under load long before Postgres does; a stuck connection must not hold a slot.
    max: settings.poolMax,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return storeOf(sql, { readTimeoutMs: settings.readTimeoutMs, plan: planCache.perTransaction });
}
