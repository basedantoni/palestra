# Market Watch ingestion runs as pg-boss jobs on a separate Fly worker, landing raw snapshots first

The daily Market Price capture (ADR 0007) runs as **pg-boss** jobs in a new always-on Fly app, `palestra-worker`. It uses the same Docker image as `palestra` with a different entry point, sits on the same private network as `palestra-db`, and runs TypeScript from the monorepo. The other scheduled jobs (the Plaid snapshot, the Whoop token refresh) are GitHub Actions crons that curl `/api/internal/*`. That pattern does the work on the 256 MB app VM, which a capture would starve. Running a script on a GitHub runner through `with-prod-db.sh` was the $0 alternative. pg-boss won because it keeps the jobs in the app, stores its queue and run history in the Postgres we already have, schedules at a fixed UTC time, retries with backoff, and has no vendor control plane. It costs about $5 a month.

Each job fetches its source, **saves the raw response to Tigris** (`raw/<source>/<date>/`, gzipped, kept indefinitely, never served), and only then derives Market Prices from that saved copy. Mapping to Printings is expected to be wrong at times, and CardTrader asks are live and can't be fetched again, so without the raw copy a mis-mapped day is lost for good. Replaying a day (`market.derive`) goes through the same derive step as a live capture.

## Considered Options

- **Vendor-hosted runners** (Trigger.dev Cloud, Windmill Cloud, Prefect, Cloudflare Workers): their compute would need a public database, and `palestra-db` is legacy Fly Postgres, which Fly no longer supports exposing.
- **Self-hosted orchestrators** (Trigger.dev, Windmill, Kestra, Temporal): too heavy for one daily job. Trigger.dev also needs Docker, which Fly Machines don't have.
- **Hatchet Cloud or Inngest `connect`**: these still need the same always-on worker, plus a vendor control plane. Inngest is SSPL-licensed.
- **Python stacks** (Dagster, Prefect, dlt): nothing in the sources forces a second language.

## Consequences

- Three independent jobs (`market.ecb`, `market.tcgcsv`, `market.cardtrader`) run at 21:17 UTC. pg-boss queue names allow no colon, so jobs are named with a dot. Each has 3 retries, and retries expire at the end of that UTC day, because the day of the capture is the Market Price's day. After the final failure, each admin user gets an in-app `market_capture_failed` notification.
- Worker-only secrets live in their own env module, so the web server never requires them. Migrations stay on `palestra`'s release command. pg-boss owns its `pgboss` schema.
- There is no public dashboard. `@pg-boss/dashboard` and manual enqueues run locally through `with-prod-db.sh`.
