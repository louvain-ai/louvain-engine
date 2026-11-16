# The app

**In short:** the app is Search and Ask over what you loaded, in a browser at `/app/` on the tool server. Run
`./engine app` to open it, and sign in with the token in `.engine/token`.

## Open it

1. Run **`./engine up`**. It serves the app beside the tools and prints its address.

```text
$ ./engine up
Starting the engine's services (the first run builds their images)...
Reranker: off (engine.config.ts names none).
Schema: loaded.
Tools: http://127.0.0.1:8080/mcp
App:   http://127.0.0.1:8080/app/
Token: .engine/token
Ready.
```

2. Run **`./engine app`**. It opens the app in this machine's browser, or prints the address to open.

```text
$ ./engine app
App: http://127.0.0.1:8080/app/ (sign in once with the token in .engine/token)
```

3. Paste the token from **`.engine/token`** into **Paste the token**.

The address follows `LOUVAIN_ENGINE_PORT` (8080 by default). `./engine status` shows it and
`./engine down` stops the app with the tool server. The app is a surface of the tool server, `app()`, which the
defaults serve beside `mcp()`; to serve the tools alone, write `surfaces: [mcp()]` in `engine.config.ts`
([Configuration](configuration.md)). The server keeps the sign-in, the cookie, the host and cross-site checks and the
headers; the app's routes (`apps/app/src/index.ts`) say only which of its paths anyone may fetch.

## Sign in

The sign-in lasts until you sign out, for at most seven days. Restarting the server signs every browser out. Signed
out, the page's data answers nothing:

```text
GET  /app/api/status                        → 401 {"error":"unauthorized"}
POST /session {"token":"nope"}              → 401 {"error":"wrong_token"}
POST /session {"token":"<.engine/token>"}   → 204, with the cookie
GET  /app/api/status                        → 200 {"documents":4,"collections":[{"name":".","documents":4}],"ask":{"ready":false,"needs":"ANTHROPIC_API_KEY"}}
```

The cookie is httpOnly, `SameSite=Strict` and named for the server's port. The page answers only the hosts it is
reached at (loopback on its port, and `LOUVAIN_ENGINE_PUBLIC_ORIGIN` behind a TLS proxy you run), refuses a write from
any other origin, and loads nothing from another host. The corner of the page shows how many documents are loaded, in
which collections, and whether Ask is ready.

## Search

1. Open **Search**, type in **Search your documents** and press **Enter**.
2. Choose the word beside a result (**Exact**, **Relevance**, **Words** or **Meaning**) to see why it is there.
3. Choose a result to open the whole document at the passage that matched.

Search runs the same call as an agent, ten documents a page, and shows only the matches. When nothing matches, the
page shows the engine's sentence alone.

## Ask

1. Set **`ANTHROPIC_API_KEY`** in `.env`.
2. Run **`./engine down`**, then **`./engine up`**.
3. Open **Ask**, type your question in **Ask about your documents** and press **Enter**.

The answer cites the documents it read. When they do not answer the question, Ask says the sources do not say. Without
a key, Ask says what it needs:

```text
POST /app/api/ask {"question":"When does the lease renew?"}   → 409 {"error":"no_key","needs":"ANTHROPIC_API_KEY"}
```

Ask answers with the answerer `engine.config.ts` names (`answerer`, [Configuration](configuration.md)). The shipped file
names the agent over Anthropic's model, `agent({ model: anthropic({ model: "claude-sonnet-5-5" }) })`; change the model
there. `scripted()` answers with no model: a fixed-form answer quoted from the documents. With no answerer named, Ask
says so, and `/app/api/status` answers `"ask":{"ready":false}`:

```text
POST /app/api/ask {"question":"When does the lease renew?"}   → 409 {"error":"no_answerer","message":"Ask has no answerer: name one in engine.config.ts, then start the engine again."}
```

**With a key, the question and the text of every document Ask reads go to the model provider.** The key stays on the
server. Search sends nothing to a model.

| Setting | Default | What it does |
| --- | --- | --- |
| `LOUVAIN_APP_ASK_ROUNDS` | 6 (1 to 10) | Model turns one answer may take |
| `LOUVAIN_APP_ASK_TOKENS` | 100000 (20000 to 400000) | Tokens one answer may spend across its turns |

Twelve searches and reads and two minutes an answer are fixed. The answer is drawn so that nothing in it can become a
link, an image or a script.
