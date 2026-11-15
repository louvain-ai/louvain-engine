# An agent's side of the engine

`agent.ts` does what an agent does with the engine's tools, without the agent: it connects to the tool server over MCP
with the token the server wrote, lists the tools, searches the sample corpus, reads the top document and prints the
matching passage with its source. It calls no model and needs no API key.

```sh
./engine up
./engine ingest folder --folder examples/sample-corpus
node --import tsx examples/agent/agent.ts
```

Pass your own question as an argument. The script exits non-zero when any step fails, and `--expect <title>` also fails
unless the top document's title contains it, so it works as an end-to-end check of the tool server (the stack job in
`.github/workflows/ci.yml` runs it that way). It speaks MCP's JSON-RPC over HTTP with `fetch`; to see what an MCP
client library adds, read it beside your own client's documentation.
