/**
 * Which apps a connector's records show as (`ConnectorDef.shows`), and nothing else of its definition: the passage
 * legs' app filter, the BM25 app terms and the sources listing's app column need exactly this. A connector registry
 * fills it when one registers; a connector that declares nothing, or none registered, shows as its own type.
 */
const SHOWS = new Map<string, readonly string[]>();

/** Record what `type`'s records show as; called by the connector registry for each definition it registers. */
export function registerConnectorApps(type: string, shows: readonly string[] | undefined): void {
  if (shows === undefined) SHOWS.delete(type);
  else SHOWS.set(type, shows);
}

/** The apps a connector's records show as: its declaration, else its own type. */
export function appsShownBy(type: string): readonly string[] {
  return SHOWS.get(type) ?? [type];
}

/** Every connector whose records can show as `app`, and `app` itself: an app filter's connectors. */
export function connectorsOfApp(app: string): string[] {
  const out = new Set<string>([app]);
  for (const [type, shows] of SHOWS) if (shows.includes(app)) out.add(type);
  return [...out].sort();
}

/**
 * A connector shown as one app other than its own name (a variant of another, a company-wide mailbox): what a record
 * of it is called where its presentation names no service. A bundle shows as several, so it is not here.
 */
export function singleAppByConnector(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [type, shows] of SHOWS) {
    const [only, ...more] = shows;
    if (only && more.length === 0 && only !== type) out[type] = only;
  }
  return out;
}
