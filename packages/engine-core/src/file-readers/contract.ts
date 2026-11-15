/**
 * A FILE READER: the plugin contract the open loader reads every file through.
 *
 * A reader is a name, what it claims, and one function from a file's bytes to its text. It decides nothing else: it
 * is never handed a path, a descriptor or the folder, and THE ENGINE HOLDS IT TO THESE BOUNDS (`bounded.ts`): it
 * opens only regular files, refuses past the byte cap before reading, races the call against a deadline, refuses text
 * past the character cap, and turns a reader that throws into a refusal for that one file. So a reader written
 * without a single bound in it is still bounded, and one that forgets a case costs one file, never the load.
 */

/** What a reader made of a file: its text (and, for a paginated format, how many pages it read), or why not. */
export type FileReading = { text: string; pages?: number } | { refused: string };

export type FileReader = {
  /** Unique among the registered readers; what the loader reports a file was read by, and what a setting names. */
  name: string;
  claims: {
    /** File name extensions, lower case, without the dot: `["pdf"]`. */
    extensions: readonly string[];
    /**
     * How specific the claim is: `specific` (the default) for a reader of exactly these formats, `fallback` for a
     * general reader that should give way to any specific one claiming the same extension.
     */
    rank?: "specific" | "fallback";
  };
  read: (bytes: Uint8Array, fileName: string) => FileReading | Promise<FileReading>;
};
