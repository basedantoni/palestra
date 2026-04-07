#!/bin/bash
set -e

APP="palestra"

echo "Fetching current deployment image..."
IMAGE=$(fly machine list --app "$APP" --json | jq -r '[.[] | select(.state == "started")][0].config.image')

if [ -z "$IMAGE" ] || [ "$IMAGE" = "null" ]; then
  echo "Error: could not determine deployed image. Is the app running?"
  exit 1
fi

echo "Running seed on ephemeral machine using image: $IMAGE"
fly machine run \
  --app "$APP" \
  --vm-memory 512 \
  --rm \
  "$IMAGE" \
  -- sh -c 'cd /app && pnpm -F @src/db db:seed'
