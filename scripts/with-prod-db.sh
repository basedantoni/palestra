#!/usr/bin/env bash
# Run a command on this machine against the prod database, through a Fly proxy.
#
#   scripts/with-prod-db.sh pnpm db:import:tcg
#   scripts/with-prod-db.sh pnpm db:backfill:tcg-artists --set OP-05
#
# Run data scripts here, never on the Fly app machine: it has 256 MB and serves
# traffic, and a catalog import there starves the web server. The prod
# DATABASE_URL is read from the app (never printed), so the database name always
# matches the app's; only its host is swapped for the local end of the proxy.
set -euo pipefail

PORT="${PROD_DB_PORT:-15432}"

url=$(fly ssh console -a palestra -C "printenv DATABASE_URL" 2>/dev/null | tr -d '\r' | tail -n 1)
if [[ "$url" != postgres* ]]; then
  echo "Could not read DATABASE_URL from the palestra app (fly auth login?)" >&2
  exit 1
fi

# The database machine may be stopped: the proxy can't wake it.
for id in $(fly machine list -a palestra-db --json | jq -r '.[] | select(.state == "stopped") | .id'); do
  echo "Starting palestra-db machine $id" >&2
  fly machine start "$id" -a palestra-db >/dev/null
done

fly proxy "$PORT:5432" -a palestra-db >/dev/null 2>&1 &
proxy=$!
trap 'kill "$proxy" 2>/dev/null' EXIT

for _ in $(seq 40); do
  nc -z localhost "$PORT" 2>/dev/null && break
  sleep 0.25
done
if ! nc -z localhost "$PORT" 2>/dev/null; then
  echo "fly proxy did not open localhost:$PORT" >&2
  exit 1
fi

DATABASE_URL=$(printf '%s' "$url" | sed -E "s#@[^/]+/#@localhost:$PORT/#") "$@"
