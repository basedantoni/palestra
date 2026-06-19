#!/bin/sh

set -eu

run_with_retries() {
  label="$1"
  command="$2"
  max_attempts="${3:-3}"

  attempt=1
  while [ "$attempt" -le "$max_attempts" ]; do
    echo "[release] ${label} attempt ${attempt}/${max_attempts}"
    if sh -c "$command"; then
      echo "[release] ${label} succeeded"
      return 0
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "[release] ${label} failed after ${max_attempts} attempts"
      return 1
    fi

    sleep_seconds=$((attempt * 5))
    echo "[release] ${label} failed; retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done
}

cd /app

run_with_retries "db:migrate" "pnpm -F @life-tracker/db db:migrate"
run_with_retries "db:seed" "pnpm -F @life-tracker/db db:seed"
