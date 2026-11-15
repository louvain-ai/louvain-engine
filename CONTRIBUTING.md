# Contributing

Thank you for wanting to improve the engine.

## How a change reaches this repository

This repository is published from another one. Each release here is a commit of the engine's files, exported from the
repository where the engine is developed; nothing here is merged back as history.

So a pull request is not merged in place. When a maintainer accepts it, they apply the same change to the source
repository, it goes through that repository's checks, and it arrives here in the next snapshot. Your commit will not
appear in this repository's history; the change will, and the pull request is closed with a link to the release that
carries it. Credit goes in the release notes.

## Before you open a pull request

- `pnpm install --frozen-lockfile`, then `pnpm run build`, `pnpm run typecheck`, `pnpm run lint` and `pnpm run test`
  must pass. The CI workflow runs the same five.
- A change to search or reading also passes the database tests (`pnpm --filter @louvain/engine test:db`; the
  operations page, "Checking it works", shows how to run them against your install). If it changes an answer or a statement on purpose, record them again with `test:db:record`
  and say in the description why each recorded difference is right.
- Keep a change to one concern, and say in the description what it fixes or adds and how you checked it.
- A change to the database schema changes `db/baseline.sql`. Describe the schema change in the pull request rather
  than editing the generated file by hand: the file is regenerated from the source repository's schema.
- Never include credentials, real personal data or a real customer's text in code, tests or fixtures.

## The README's diagrams

The diagrams in `README.md` are images, `assets/flow.svg` and `assets/architecture.svg`, so they show in every viewer.
They are drawn from the Mermaid sources in `docs/diagrams/` (`flow.mmd`, `architecture.mmd`) with the configuration
beside them (`docs/diagrams/mermaid-config.json`: the theme, and labels as SVG text rather than HTML). To change one,
edit its `.mmd` file and draw it again, for example with the Mermaid CLI (it runs a headless browser):

```sh
npx -y @mermaid-js/mermaid-cli@11 -i docs/diagrams/flow.mmd -o assets/flow.svg \
  -c docs/diagrams/mermaid-config.json -b white
```

Then open the README and check that the picture reads on both a light and a dark page. In the pull request, say which
diagram changed; a maintainer redraws it in the source repository.

## Reporting a security problem

Do not open a public issue. See `SECURITY.md`.

## Conduct

Everyone taking part is expected to follow `CODE_OF_CONDUCT.md`.
