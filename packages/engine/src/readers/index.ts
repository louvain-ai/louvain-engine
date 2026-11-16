/**
 * The file reader lane: the readers the loader reads files through, as the configuration names them. Which
 * reader reads a file is the lane's decision (`registry.ts`); the bounds around it are the engine's (`bounded.ts`).
 */

export type { FileReader, FileReading } from "@louvain/engine-core";
export { type FileOutcome, readFileBounded } from "./bounded.js";
export { FileReaderConflict, type FileReaderLane, fileReaderLane } from "./registry.js";
