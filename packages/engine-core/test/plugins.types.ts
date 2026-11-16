/**
 * The guarantees that are types, as code the compiler must accept or refuse. Compiled, never run, by
 * `plugins.test.ts`: an `@ts-expect-error` that stops being an error fails that compile too, so each line below holds.
 */
import { z } from "zod";
import { defineEngine } from "../src/plugins/config.js";
import { definePlugin } from "../src/plugins/plugin.js";
import { createPluginRegistry } from "../src/plugins/registry.js";
import type { FileReader } from "../src/readers/contract.js";

const registry = await createPluginRegistry(defineEngine({}));

// `list` returns the kind's contract.
export const readers: readonly FileReader[] = registry.list("fileReader").map((r) => r.plugin);

// A kind that is not a contract does not compile.
// @ts-expect-error "translator" is not a kind
registry.list("translator");

// Only `defineEngine` makes what a registry is built from, so nothing reaches it unchecked.
// @ts-expect-error a bare object is not a defined configuration
await createPluginRegistry({});

// A plugin whose `create` returns something that is not its kind's contract does not compile.
definePlugin({
  kind: "fileReader",
  name: "wrong",
  // @ts-expect-error a reader must claim extensions and read
  create: () => ({ name: "wrong" }),
});

// A factory's settings are its schema's input, and `create` receives its output.
const capped = definePlugin({
  kind: "fileReader",
  name: "capped",
  settings: z.object({ limit: z.number().default(10) }),
  create: ({ limit }) => ({
    name: "capped",
    claims: { extensions: [String(limit)] },
    read: () => ({ text: "" }),
  }),
});
defineEngine({ readers: [capped({})] });
// @ts-expect-error a limit is a number
capped({ limit: "ten" });
// Settings that all have defaults may be left out; a required one may not.
const roomy = definePlugin({
  kind: "fileReader",
  name: "roomy",
  settings: z.object({ limit: z.number().default(10) }),
  create: () => ({ name: "roomy", claims: { extensions: [] }, read: () => ({ text: "" }) }),
});
defineEngine({ readers: [roomy()] });
const needy = definePlugin({
  kind: "fileReader",
  name: "needy",
  settings: z.object({ url: z.url() }),
  create: () => ({ name: "needy", claims: { extensions: [] }, read: () => ({ text: "" }) }),
});
// @ts-expect-error a required setting cannot be left out
needy();

// A configuration names only what it holds, and nothing the host binds.
// @ts-expect-error the readable set is the host's, never a configuration's
defineEngine({ readableSet: {} });
// @ts-expect-error readers is a list
defineEngine({ readers: capped({}) });
