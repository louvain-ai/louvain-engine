/** A file reader: plain text and Markdown, read as UTF-8. Its README walks every line. */
import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";

const READS = ["txt", "md", "markdown"] as const;
const utf8 = new TextDecoder();

export const text = definePlugin({
  kind: "fileReader",
  name: "text",
  settings: z.object({ extensions: z.array(z.enum(READS)).default([...READS]) }),
  create: ({ extensions }) => ({
    name: "text",
    claims: { extensions: [...new Set(extensions)] },
    read: (bytes) => ({ text: utf8.decode(bytes) }),
  }),
});
