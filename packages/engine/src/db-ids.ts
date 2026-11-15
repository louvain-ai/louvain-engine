/** The ids every row and every reader agree on: a sanitised id and the collection identity. */

/**
 * An id keeps [a-zA-Z0-9/_|\-=+] and every other character becomes `_`, once, at the ingest boundary, so every
 * row that stores an id and every reader that is handed one agree on it.
 */
export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9/_|=+-]/g, "_");
}

/**
 * The collection identity: connector, workspace, then the source's own name. A name is unique only within a workspace,
 * so an org with two chat workspaces has two `#general`s; the workspace in the identity keeps them two collections.
 */
export function containerId(connector: string, workspace: string, name: string): string {
  return sanitizeId(`${connector}/${workspace}/${name}`);
}
