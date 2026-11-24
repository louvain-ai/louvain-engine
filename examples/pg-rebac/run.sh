#!/usr/bin/env bash
# The pg_rebac example from one command, at the engine's repository root: the engine's stack, SpiceDB and rebacd laid
# over it, the two collections loaded, and the same search as alice and as bob (demo.ts). Run it again at will: the
# grants are touched, not added twice. `./engine down` and `docker compose ... down` (README.md) stop it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

./engine up
LOUVAIN_PG_PASSWORD="$(cat .engine/db-password)"
LOUVAIN_SIDECAR_TOKEN="$(cat .engine/sidecar-token)"
export LOUVAIN_PG_PASSWORD LOUVAIN_SIDECAR_TOKEN
setting() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
pg_port="$(setting LOUVAIN_PG_HOST_PORT)"
export DATABASE_URL="postgres://engine:$LOUVAIN_PG_PASSWORD@127.0.0.1:${pg_port:-5434}/engine"
export LOUVAIN_EMBEDDINGS_URL="http://127.0.0.1:$(e="$(setting LOUVAIN_EMBEDDINGS_HOST_PORT)"; echo "${e:-8091}")"
export LOUVAIN_BM25_URL="http://127.0.0.1:$(b="$(setting LOUVAIN_BM25_HOST_PORT)"; echo "${b:-8095}")"

# --no-deps everywhere: the engine's own services are already up, and are left exactly as ./engine started them.
compose() { docker compose --env-file /dev/null -f docker-compose.yml -f examples/pg-rebac/compose.yml "$@"; }
echo "Starting SpiceDB and installing pg_rebac's SQL (the first run builds rebacd)..."
compose up -d --wait --no-deps spicedb
compose run --rm --no-deps rebac-schema
compose up -d --no-deps rebacd

./engine ingest folder --folder examples/pg-rebac/corpus/handbook
./engine ingest folder --folder examples/pg-rebac/corpus/payroll
node --import tsx examples/pg-rebac/demo.ts
