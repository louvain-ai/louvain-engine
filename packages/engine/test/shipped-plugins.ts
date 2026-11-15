import type { PluginRegistry } from "@louvain/engine-core";

/**
 * The plugins the open build ships, started as `./engine` starts them with no engine.config.ts (the CLI's
 * `defaults.ts`): what a test of the open build reads files and searches through. Imported when called, so a test
 * binds the host before any of them loads.
 */
export async function shippedPlugins(): Promise<PluginRegistry> {
  const { defineEngine } = await import("@louvain/engine-core");
  const { createPluginRegistry } = await import("@louvain/engine-core");
  const { folder } = await import("../src/plugins/source-folder/index.js");
  const { records } = await import("../src/plugins/source-records/index.js");
  const { documents } = await import("@louvain/reader-documents");
  const { text } = await import("@louvain/reader-text");
  const { figuresRetriever } = await import("../src/plugins/retriever-figures/index.js");
  const { keywordRetriever } = await import("../src/plugins/retriever-keyword/index.js");
  const { vectorRetriever } = await import("../src/plugins/retriever-vector/index.js");
  return createPluginRegistry({
    ...defineEngine({ readers: [documents(), text()], sources: [folder(), records()] }),
    retriever: [vectorRetriever(), keywordRetriever(), figuresRetriever()],
  });
}

/** The shipped readers' lane, for an ingest run that reads files. */
export async function shippedLane() {
  const { fileReaderLane } = await import("../src/open/file-readers/index.js");
  return fileReaderLane(await shippedPlugins());
}
