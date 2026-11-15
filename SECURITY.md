# Security

## Reporting a vulnerability

Please report a vulnerability privately, never in a public issue, pull request or discussion. Use this repository's
private vulnerability reporting ("Security" tab, then "Report a vulnerability"), which reaches the maintainers only.

Include what you found, the version or commit, how to reproduce it, and what an attacker could do with it. We will
acknowledge the report, keep you informed while we work on it, and credit you in the release that fixes it unless you
ask us not to.

## Scope

In scope: the code in this repository, its database schema (`db/baseline.sql`) and the sidecar images built from
`apps/nlp`. A problem in a third-party dependency is in scope when the engine's use of it makes it exploitable.

The engine reads through one readable-set resolver, and this build's resolver lets the one reader it serves read every
collection: it serves one reader by design. Running it for several people who must not see each other's data is outside
what this build promises; a report that one reader reads everything is expected behaviour, not a vulnerability. A way to read past the predicate the resolver's set feeds (a query that ignores the set, or a
cache served across sets) is in scope.

On one machine, a caller is anyone who can reach a loopback port: another local user, or a web page open in a
browser. Postgres, the sidecars and the tool server listen on `127.0.0.1` only, and each requires a secret made for
the install, which `./engine up` makes and keeps owner-only (mode 600); none has a default credential. A way to reach
one without its secret is in scope. `.env` and `.env.example` are configuration and so trusted, but `./engine` takes only
the settings `.env.example` lists from `.env`, as data: a way to run code through a `.env` line is in scope.

engine.config.ts and every plugin it imports are trusted code: they run in the engine's process with its database
connection and its files. A plugin that misbehaves is not a vulnerability in the engine; a way to make the engine load
code that engine.config.ts does not import is in scope.

Nothing leaves the machine unless you configure it to. A remote reranker, once configured, receives each search and
the text of the documents it reranks; the app's Ask, given a model key, sends each question and the documents it reads
to that model's provider. Both are your choice and outside the engine's control once sent.

## Supported versions

Only the latest release receives security fixes.
