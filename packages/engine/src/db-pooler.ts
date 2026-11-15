/** Whether a database URL is, or may be, a pooler's: a pooler may refuse a startup parameter (`db-settings.ts`). */

/**
 * Does this connection string point at a transaction pooler? The managed providers' shapes, plus an explicit
 * `pgbouncer=true` for a URL this process does not open itself. A false negative treats a pooler as a direct endpoint;
 * a false positive refuses a start that would have worked.
 */
export function looksPooled(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes("-pooler") || // Neon
      u.hostname.includes(".proxy-") || // AWS RDS Proxy
      u.port === "6543" || // Supabase transaction pooler
      u.searchParams.get("pgbouncer") === "true"
    );
  } catch {
    return false;
  }
}

/**
 * Could this connection string be ANY pooler — the question a startup parameter
 * asks, where the costs run the other way from `looksPooled`: a false positive
 * only moves the setting from the connection to each bounded read, a false
 * negative is refused at connect. So it is broader: PgBouncer's default port,
 * and any host naming a pooler or PgBouncer (Supabase's `*.pooler.supabase.com`
 * session pooler among them). An unparseable URL is treated as pooled.
 */
export function mayBePooled(url: string): boolean {
  if (looksPooled(url)) return true;
  try {
    const u = new URL(url);
    return u.port === "6432" || /pooler|pgbouncer/i.test(u.hostname);
  } catch {
    // swallowed: a URL this cannot read (a multi-host list) may be anything, and the
    // safe answer for a startup parameter is "may be a pooler".
    return true;
  }
}
