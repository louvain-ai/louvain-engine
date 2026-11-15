import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** The corpus's nine sources, and the documents under them: `corpus/<source>/<container>/dsid_<hex>__<slug>.txt`. */
export const SOURCES = [
  "slack",
  "gmail",
  "confluence",
  "hubspot",
  "linear",
  "google_drive",
  "fireflies",
  "github",
  "jira",
] as const;
export type Source = (typeof SOURCES)[number];

export type Doc = { dsid: string; source: Source; container: string; slug: string; path: string };

/** A conversation is a message, a tracker or CRM row a record, and everything else a document. */
export function kindOf(source: Source): "message" | "document" | "record" {
  if (source === "slack" || source === "gmail") return "message";
  if (source === "linear" || source === "jira" || source === "hubspot") return "record";
  return "document";
}

const DSID_FILE = /^(dsid_[0-9a-f]{32})__(.+)\.txt$/;
const isSource = (name: string): name is Source => (SOURCES as readonly string[]).includes(name);

/** Every document of the corpus, in dsid order: a shuffle across sources and containers, as the scored load read it. */
export function walk(root: string): Doc[] {
  const docs: Doc[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const doc = docAt(root, path, entry.name);
        if (doc) docs.push(doc);
      }
    }
  };
  visit(root);
  return docs.sort((a, b) => a.dsid.localeCompare(b.dsid));
}

function docAt(root: string, path: string, name: string): Doc | null {
  const m = DSID_FILE.exec(name);
  const container = relative(root, join(path, "..")).split("\\").join("/");
  const source = container.split("/")[0] ?? "";
  if (!m?.[1] || !m[2] || !isSource(source)) return null;
  return { dsid: m[1], source, container, slug: m[2], path };
}
