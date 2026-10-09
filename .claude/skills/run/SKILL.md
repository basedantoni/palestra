---
name: run
description: Start Palestra locally, log in as the seeded dev user, and drive the web app with finance fixture data. Use to verify a UI or API change in the running app before handing QA steps to the user.
---

# Run Palestra

Server: http://localhost:3000. Web: http://localhost:3001. Both ports are fixed (CORS and Better-Auth trust only 3001).

## 1. Check what is already running

```sh
lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN
```

If both ports are listening, the user's dev servers are up. Reuse them and skip to step 3. You will not have their logs. Do not kill them.

## 2. Start the stack

First run only. Skip any `.env` that already exists, so you don't overwrite the user's secrets:

```sh
cp apps/server/.env.example apps/server/.env   # local defaults boot as-is
cp apps/web/.env.example apps/web/.env
```

```sh
pnpm install
pnpm db:start            # Postgres in Docker on 5433
pnpm db:migrate
pnpm db:seed             # exercises + templates (idempotent)
pnpm db:seed:finance     # dev user + finance fixtures (idempotent; resets them)
mkdir -p logs
pnpm dev:server > logs/server.log 2>&1   # run_in_background
pnpm dev:web    > logs/web.log 2>&1      # run_in_background
```

`logs/` is gitignored. Read the logs with `tail -n 50 logs/server.log`. Wait until `curl -s -o /dev/null -w '%{http_code}' localhost:3001` prints 200.

## 3. Log in

Dev user, created only by `pnpm db:seed:finance` (it refuses to run with `NODE_ENV=production`):

- email `dev@palestra.local`
- password `palestra-dev-password`

Onboarding is already done.

- **Browser:** open http://localhost:3001/login and sign in with the form.
- **API (curl):** get a session cookie, then call tRPC with it.

```sh
curl -s -c "$CLAUDE_JOB_DIR/tmp/cookies.txt" -X POST localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3001' \
  -d '{"email":"dev@palestra.local","password":"palestra-dev-password"}'

curl -s -b "$CLAUDE_JOB_DIR/tmp/cookies.txt" -G localhost:3000/trpc/transactions.list \
  --data-urlencode "input={\"period\":{\"kind\":\"month\",\"month\":\"$(date -u +%Y-%m)\"}}"
```

## 4. Finance fixtures

`scripts/seed-finance.ts` resets a "Fixture Bank" item with checking, savings and credit card accounts. All dates fall in the current month, so http://localhost:3001/finance/transactions shows every fixture row by default.

| Case | Rows |
| --- | --- |
| Repeated merchant | `BLUE BOTTLE COFFEE #12` ×5 across two accounts |
| Blank Manual Category (`categoryOverridden`, no category) | one Blue Bottle row, `AMZN Mktp US*2K4` |
| Pending | `UBER *TRIP`, `WHOLEFDS AUS 10234` |
| Transfer pair (linked `transferPairId`) | `ONLINE TRANSFER TO SAV` / `FROM CHK`, $500 |
| Unknown Plaid category → Uncategorized | `SQ *MYSTERY VENDOR` (unknown PFC), `POS DEBIT 8812` (null PFC) |

Re-running `pnpm db:seed:finance` puts the fixtures back. It also deletes the dev user's Category Rules, so you can mutate the data freely while testing. "Sync now" on Fixture Bank fails because it has no real Plaid token. That is expected.

## 5. Stop

Stop only the servers you started (`pkill -f "turbo -F server dev"`, `pkill -f "turbo -F web dev"`). Leave Postgres running unless you started it in this session.
