# source-http

The HTTP door: `POST /ingest` on the tool server, a JSON body `{ "collection": …, "items": [ … ] }` of at most 500
items, each answered on its own. It is off unless engine.config.ts names it, and it opens only with its own token, at
least 32 characters and never the read token agents hold:

```ts
// engine.config.ts
import { folder, records } from "@louvain/engine";
import { defineEngine } from "@louvain/engine-core";
import { http } from "@louvain/source-http";

export default defineEngine({
  sources: [folder(), records(), http({ token: process.env.LOUVAIN_ENGINE_INGEST_TOKEN })],
});
```

A configuration's list replaces the defaults, so it names the folder and records sources to keep them. The door never
reads a file an item names. Its tests are here and the engine's HTTP door tests.

A source of your own is one file like this one: `definePlugin({ kind: "source", name, create: () => source({ request,
open }) })`, where `request` is the schema of what a run asks for and `open` returns the listing. A source that reads
a service uses the fetch `open` is handed, which reaches only public addresses over HTTPS.
