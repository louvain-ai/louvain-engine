# The engine's app

Search and Ask over your documents, in a browser. `./engine up` serves it beside the tools:

```
Tools: http://127.0.0.1:8080/mcp
App:   http://127.0.0.1:8080/app/
```

Open the app's address (`./engine app` opens it in this machine's browser, or prints it where none can open) and sign in
once with the engine's token (`cat .engine/token`); the status corner's card signs out. Search works at once. Ask
answers with your own model key: add `ANTHROPIC_API_KEY=…` to `.env` and start the engine again.
`surfaces: [mcp()]` in `engine.config.ts` serves the tools alone.

## What it is made of

No framework and nothing to bundle: TypeScript compiled by `tsc` to modules the browser loads as they are, five
stylesheets, two typefaces, and one library. The server sends 22 KB of the app's own script, 13 KB of the library and
10 KB of styles, compressed, and 60 KB of fonts.

## What a search says

A search page is its matches, each saying how it matched when the engine says so ("Exact match" for the document the
search names by its own identifier or whole title, which leads; else by its words, or by meaning) and the number it
carries: the reranker's relevance with a thin meter when there is one, else the similarity in meaning, two decimals. One
tap on the number opens every figure the result carries in plain words, its separate ranks by words and by meaning
included. "More results" pages on only while more matches may remain. When nothing matches, the page is
the engine's sentence alone; what the engine lists as only loosely related is for agents, and the app does not show
it. A search with no word and no figure in it is refused by the engine, and its sentence is the page. The split is the
engine's (`matched`, `note`, `looselyRelated` and each hit's `match`); a page without it is split
by one function, `derived` in `src/matches.ts`, which checks only the words and says so. Ask uses the same page: a search
that matched nothing is "nothing matched" in the trail, and an answer the sources do not give is "The sources do not
say", with what was read named as read, never as support. A query's figures are lit whole (`2,400`, `2400`, `£2,400`
alike), identifiers whole, words where a word starts.

## How an answer is drawn

An answer is markdown, read by marked's lexer into tokens, never into HTML: `marked` (MIT) is a dependency of the
app, pinned at 17.0.6, and the server serves the installed package's own module and licence to the page
(`src/static.ts`, `web/lexer.ts`); no copy of it is kept here. `web/md-tree.ts` maps the
tokens onto a closed set of elements (paragraphs, headings, lists, tables, quotes, code, emphasis) and builds each
node itself, so raw HTML, an image, a script or a link anywhere but a source shown in this answer stays text, and no
attribute comes from what the answer wrote. A citation is a numbered chip right after the punctuation that ends its
claim. While an answer streams, each finished block is drawn once and kept; the block being written stays plain text
while it is open, except a list, whose finished items are already items.

| Where | What |
| --- | --- |
| `src/index.ts` | `app()`, the surface, and its routes: the page, `api/status`, `api/search`, `api/document`, `api/ask` |
| `src/library.ts` | Search and read through the engine's own two tools, as an agent does |
| `src/ask/` | Ask: the contracts (`model.ts`; `answerer.ts`, the engine's; `contract.ts` for limits), the answerers a configuration names (`plugins.ts`), the flow and its bound tools (`flow.ts`), the limits, the `agent` loop, the Anthropic model, the `scripted` answerer, the route |
| `src/matches.ts` | What a search found, split into matches and the loosely related: the engine's, or derived from the words when the page lacks it |
| `web/` | The page's script: one file per screen and a few helpers; `markdown.ts`, `md-tree.ts` and `cite.ts` draw an answer, `terms.ts` lights a query |
| `public/` | The page, its styles (tokens, base, parts, screens, answer), its fonts and its one library with their licences |

## How it attaches

`app()` is a surface (`@louvain/engine-core`'s `plugins/surface.ts`): a list of routes over web-standard `Request` and
`Response`, which the configuration's `surfaces` names (the defaults name it beside `mcp()`). Each route says what it
needs: the page and its files need nothing; everything under `/app/api/` reads, with the browser's sign-in. A read route
is handed the reader's reading: the engine's two tools, how much is loaded, the answerer `engine.config.ts` names (null
for none) and an opaque name for the reader, never a token or a cookie. The server keeps everything that decides who
may do what: signing in, the cookie, the host and cross-site checks, the security headers. The app depends on the core
alone.

## Hosting it

The server listens on this machine only. To reach it from elsewhere, put a TLS reverse proxy in front and set
`LOUVAIN_ENGINE_PUBLIC_ORIGIN` to the address people use (`https://engine.example.com`), and let through only people
who may read every loaded document: whoever signs in reads all of it.

The server answers only the hosts it is reached at (loopback on its port, and that origin), and trusts no
`X-Forwarded-*` header. The sign-in cookie is named for this engine and its port, so two engines on one machine never
share it; behind an `https` origin it is `Secure` and `__Host-`. Signing out revokes the sign-in on the server, and a
new token or a restart signs every browser out.

## Ask and its limits

Ask runs on the server and is made of two contracts. A `Model` takes one turn of a conversation; an `Answerer` turns a
question into answer events with the tools it is handed. The `agent` answerer takes a model and runs the tool loop: the
model searches and reads, then answers citing what it read. The browser never sees the key or the token.

The flow around the answerer (`flow.ts`) decides what no answerer can change: it binds the engine's two tools for the
answer and gives each document they show a random ref, fenced so a document cannot pose as another; only a
citation of a ref minted in that answer reaches the page (whether the document supports the sentence is not
checked); one answer runs at a
time per signed-in browser; Stop or a closed tab ends it at once (a search or read already running finishes on its
own). The limits: 12 searches and reads an answer and two minutes, held by the flow; 6 model turns
(`LOUVAIN_APP_ASK_ROUNDS`, at most 10) and 100,000 tokens across them (`LOUVAIN_APP_ASK_TOKENS`, 20,000 to 400,000),
held by the agent, which starts a turn only when its worst case fits what is left (the conversation so far in, a full
turn of 16,000 tokens out, thinking included); 12,000 characters of a document a read.

## Another answerer, or another model

Ask writes with the answerer `engine.config.ts` names in `answerer`, a value like any plugin. Two ship in
`src/ask/plugins.ts`: `agent({ model })`, the tool loop over a model, and `scripted()`, which needs no model and is the
place to start reading. The shipped configuration names `agent({ model: anthropic({ model: "claude-sonnet-5-5" }) })`;
`anthropic` reads its key from `ANTHROPIC_API_KEY`. With no answerer named, Ask says so and the status card reads
"Ask has no answerer". A different model is a value passed to `agent`:

```ts
// engine.config.ts
import { agent } from "@louvain/engine-app";
import { defineEngine } from "@louvain/engine-core";

const key = process.env.MY_MODEL_KEY?.trim();
export default defineEngine({ answerer: agent({ model: key ? myModel(key) : { needs: "MY_MODEL_KEY" } }) });
```

`myModel` returns a `Model`: `{ name, turn(turn) }`, where `turn` yields the words as they come and then one `done`
with the message, its tool calls and what it cost. A model without its key is `{ needs: "<setting>" }`, and Ask says
which setting it needs. An answerer of your own is `definePlugin({ kind: "answerer", … })` (the engine's Plugins page).

## Fonts, the library and marks

Host Grotesk and JetBrains Mono, both under the SIL Open Font Licence 1.1 (`public/fonts/OFL-*.txt`). marked, under the
MIT licence: its own licence file ships with the package, and the server serves it beside the module. The icons are
drawn here. The name, wordmark and mark are trademarks: the repository's `TRADEMARKS.md` says how to use them.
