import { extname } from "node:path";
import type { FileReader, PluginRegistry } from "@louvain/engine-core";

/**
 * Which reader reads a file, decided once from the configuration's readers. Several may claim an extension; the most
 * specific claim wins (`specific` over `fallback`). Two claims of the same rank on one extension are an ambiguity, not
 * a choice to make silently, so the lane refuses it before any file is read, naming the extension and both readers;
 * the configuration settles it by keeping only one of them.
 */
export class FileReaderConflict extends Error {}

export type FileReaderLane = {
  /** The reader for a file name, or undefined when none claims its extension. */
  readerFor: (fileName: string) => FileReader | undefined;
};

export function fileReaderLane(plugins: PluginRegistry): FileReaderLane {
  const readers = plugins.list("fileReader").map((started) => started.plugin);
  const named = new Set<string>();
  for (const { name } of readers) {
    if (named.has(name)) throw new FileReaderConflict(`two file readers are named "${name}"`);
    named.add(name);
  }
  const chosen = choose(readers);
  return { readerFor: (fileName) => chosen.get(normalExt(extname(fileName))) };
}

function choose(readers: readonly FileReader[]): Map<string, FileReader> {
  const byExt = new Map<string, FileReader[]>();
  for (const reader of readers)
    for (const ext of reader.claims.extensions)
      byExt.set(normalExt(ext), [...(byExt.get(normalExt(ext)) ?? []), reader]);
  const chosen = new Map<string, FileReader>();
  for (const [ext, claimants] of byExt) {
    const specific = claimants.filter((r) => (r.claims.rank ?? "specific") === "specific");
    const top = specific.length > 0 ? specific : claimants;
    if (top.length > 1)
      throw new FileReaderConflict(
        `two file readers claim .${ext} at the same rank (${top.map((r) => r.name).join(", ")}): ` +
          "keep only one of them in engine.config.ts's readers",
      );
    const [only] = top;
    if (only) chosen.set(ext, only);
  }
  return chosen;
}

const normalExt = (ext: string): string => ext.trim().toLowerCase().replace(/^\./, "");
